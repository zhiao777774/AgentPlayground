from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
import requests
import asyncio
import os
import uuid
from typing import List, Optional
from pymilvus import connections, FieldSchema, CollectionSchema, DataType, Collection, utility

app = FastAPI(title="AgentPlayground RAG Service")

# Allow requests from the Node.js backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
EMBEDDING_API_URL = os.getenv("EMBEDDING_API_URL", "http://host.docker.internal:11434/api/embeddings")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
MILVUS_HOST = os.getenv("MILVUS_HOST", "milvus-standalone")
MILVUS_PORT = os.getenv("MILVUS_PORT", "19530")
MILVUS_DB = os.getenv("MILVUS_DB", "default")
COLLECTION_NAME = "knowledge_base"

# External LLM configuration for Contextual Chunking synthesis
SUMMARY_LLM_API_BASE = os.getenv("SUMMARY_LLM_API_BASE", "http://host.docker.internal:11434/v1")
SUMMARY_LLM_API_KEY = os.getenv("SUMMARY_LLM_API_KEY", "ollama")
SUMMARY_LLM_MODEL = os.getenv("SUMMARY_LLM_MODEL", "qwen3:8b")

# Document Models
class SearchRequest(BaseModel):
    query: str
    document_ids: Optional[List[str]] = None
    limit: Optional[int] = 5

class DeleteRequest(BaseModel):
    document_id: str

# Connect to Milvus on startup
@app.on_event("startup")
def startup_event():
    print(f"Connecting to Milvus at {MILVUS_HOST}:{MILVUS_PORT}, db={MILVUS_DB}")
    try:
        connect_milvus()
        setup_collection()
    except Exception as e:
        print(f"Failed to connect to Milvus on startup: {e}")
        # In a real app we might retry, but for now we'll attempt connection on first use if it fails here

def connect_milvus():
    if not connections.has_connection("default"):
        connections.connect(
            "default",
            host=MILVUS_HOST,
            port=MILVUS_PORT,
            db_name=MILVUS_DB,
        )

def setup_collection():
    if utility.has_collection(COLLECTION_NAME):
        return Collection(COLLECTION_NAME)
    
    # Qwen3-Embedding-0.6B outputs 1024 dimensions
    dim = 1024

    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=100),
        FieldSchema(name="document_id", dtype=DataType.VARCHAR, max_length=100),
        FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=dim)
    ]
    schema = CollectionSchema(fields, description="Knowledge Base Chunks")
    collection = Collection(name=COLLECTION_NAME, schema=schema, using='default')
    
    # Create HNSW Index
    index_params = {
        "metric_type": "COSINE",
        "index_type": "HNSW",
        "params": {"M": 8, "efConstruction": 64}
    }
    collection.create_index(field_name="embedding", index_params=index_params)
    return collection

def get_embedding(text: str) -> List[float]:
    """Call an embedding endpoint (supports OpenAI-compatible and Ollama native)."""
    try:
        headers = {"Content-Type": "application/json"}
        api_key = os.getenv("EMBEDDING_API_KEY", "")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            
        is_openai_format = "/v1/" in EMBEDDING_API_URL
        
        payload = {
            "model": EMBEDDING_MODEL,
        }
        # OpenAI/vLLM use 'input', Ollama native uses 'prompt'
        if is_openai_format:
            payload["input"] = text
        else:
            payload["prompt"] = text
            
        response = requests.post(EMBEDDING_API_URL, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        
        if is_openai_format and "data" in data and len(data["data"]) > 0:
            return data["data"][0]["embedding"]
        elif "embedding" in data:
            return data["embedding"]
        else:
            print(f"Unexpected embedding response format: {data}")
            return []
            
    except Exception as e:
        print(f"Error getting embedding from {EMBEDDING_API_URL}: {e}")
        return []

def generate_context(document_text: str, chunk_text: Optional[str] = None) -> str:
    """Use an LLM to generate a context. 
    If chunk_text is None, generates a global document summary.
    If chunk_text is provided, implements Anthropic's Contextual Retrieval by situating the chunk within the document.
    """
    if not SUMMARY_LLM_API_BASE:
        print("SUMMARY_LLM_API_BASE is not configured, falling back to basic extraction.")
        return document_text[:500].strip() if not chunk_text else ""
        
    mode = "chunk-specific" if chunk_text else "global summary"
    print(f"Generating {mode} context using {SUMMARY_LLM_MODEL} at {SUMMARY_LLM_API_BASE}...")
    
    if chunk_text:
        # Anthropic Style Contextual Prompt
        prompt = f"""<document>
{document_text}
</document>

Here is the chunk we want to situate within the whole document
<chunk>
{chunk_text}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."""
        system_msg = "You are a helpful assistant that generates extremely concise chunk-specific context for search retrieval."
    else:
        # Lightweight Global Summary Prompt
        prompt = f"""You are an expert document analyzer. 
Please provide a very concise, high-level summary of the following document. 
Your summary should capture the main topic, purpose, and core entities discussed.
Keep it strictly under 100 words.

Document:
{document_text}
"""
        system_msg = "You are a helpful assistant that generates extremely concise document summaries."

    try:
        url = f"{SUMMARY_LLM_API_BASE.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SUMMARY_LLM_API_KEY}"
        }
        payload = {
            "model": SUMMARY_LLM_MODEL,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1,
            "max_tokens": 150
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        
        summary = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
        if summary:
            return summary
        else:
            print("LLM returned an empty context, falling back.")
            return document_text[:500].strip() if not chunk_text else ""
            
    except Exception as e:
        print(f"Error generating context from LLM: {e}")
        return document_text[:500].strip() if not chunk_text else ""

def extract_text_pymupdf(file_path: str) -> str:
    """Extract text from PDF using PyMuPDF (fitz)."""
    text = ""
    try:
        doc = fitz.open(file_path)
        for page in doc:
            text += page.get_text() + "\n"
    except Exception as e:
        print(f"Error extracting text: {e}")
    return text

def extract_text_txt(file_path: str) -> str:
    """Extract text from a plain text file."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        print(f"Error reading text file: {e}")
        return ""

def extract_text(file_path: str) -> str:
    """Extract text from a file based on its extension."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return extract_text_pymupdf(file_path)
    elif ext == ".txt":
        return extract_text_txt(file_path)
    else:
        print(f"Unsupported file extension: {ext}")
        return ""

def chunk_text(text: str, chunk_size=1000, overlap=200) -> List[str]:
    """A simple fallback chunker if LangChain isn't installed. Splits by char length."""
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = start + chunk_size
        
        # If we are not at the end of the text, try to find a natural break point (newline or period)
        if end < text_len:
            # Look backwards for a newline or period within the last 'overlap' characters
            search_window = text[max(start, end - 150):end]
            last_newline = search_window.rfind('\n')
            last_period = search_window.rfind('. ')
            
            if last_newline != -1:
                end = max(start, end - 150) + last_newline + 1
            elif last_period != -1:
                end = max(start, end - 150) + last_period + 2
                
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
            
        start = end - overlap
        
    return chunks

def process_document_task(document_id: str, file_path: str):
    """Background task to extract, chunk, embed, and store in Milvus."""
    print(f"Processing document {document_id} from {file_path}")
    try:
        # 1. Parse
        text = extract_text(file_path)
        if not text.strip():
            print(f"No text extracted from {document_id}")
            return
            
        # 2. Chunk
        chunk_size = int(os.getenv("CHUNK_SIZE", "800"))
        chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "150"))
        chunks = chunk_text(text, chunk_size=chunk_size, overlap=chunk_overlap)
        print(f"Generated {len(chunks)} chunks for {document_id}")
        
        # 3. Connect to collection
        # Ensure connection is alive
        connect_milvus()
        
        collection = Collection(COLLECTION_NAME)
        
        # 4. Embed & Insert (Batching is better, doing sequentially for simplicity first)
        ids = []
        doc_ids = []
        texts = []
        embeddings = []
        
        method_name = os.getenv("CHUNK_METHOD", "contextual").lower()
        
        global_context = ""
        # Determine global context if using lightweight contextual chunking
        if method_name == "contextual":
            global_context = generate_context(text)
        
        for i, chunk in enumerate(chunks):
            if method_name == "anthropic":
                # Heavyweight chunk-specific context retrieval
                chunk_specific_context = generate_context(text, chunk_text=chunk)
                embedding_text = f"{chunk_specific_context}\n{chunk}" if chunk_specific_context else chunk
            elif method_name == "contextual":
                # Lightweight global context prepend
                embedding_text = f"Document Context: {global_context}\n\nChunk: {chunk}" if global_context else chunk
            else:
                # Vanilla or fallback
                embedding_text = chunk
                
            emb = get_embedding(embedding_text)
            if emb:
                # Dynamic dimension fix for first chunk if needed (Requires dropping collection if wrong)
                # In production, ensure dimension is known beforehand.
                ids.append(f"{document_id}_{i}")
                doc_ids.append(document_id)
                texts.append(chunk) # We store the original chunk for retrieval, NOT the prepended one!
                embeddings.append(emb)
        
        if embeddings:
            collection.insert([ids, doc_ids, texts, embeddings])
            collection.flush()
            print(f"Successfully inserted {len(embeddings)} vectors into Milvus for {document_id} using {method_name} chunking")
            
    except Exception as e:
        print(f"Error processing document {document_id}: {e}")

def process_document_late_chunking(document_id: str, file_path: str):
    """Placeholder for actual Late Chunking implementation.
    This method will compute token-level embeddings for the full document
    and then apply mean pooling over chunk boundaries.
    """
    print(f"Late Chunking is not yet implemented fully for {document_id}.")
    raise NotImplementedError("Late Chunking method is pending implementation.")

@app.post("/api/rag/process")
async def process_document(document_id: str, file: UploadFile = File(...)):
    """Uploads a file and processes it synchronously (parse, chunk, embed, insert to Milvus)."""
    # Save file temporarily with original extension
    temp_dir = "/tmp/rag_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or ".pdf")[1].lower()
    if ext not in (".pdf", ".txt"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}. Only .pdf and .txt are supported.")
    temp_path = os.path.join(temp_dir, f"{document_id}{ext}")
    
    with open(temp_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)

    # Process synchronously so the caller knows the real result
    try:
        chunk_method = os.getenv("CHUNK_METHOD", "contextual").lower()
        
        if chunk_method == "late":
            process_document_late_chunking(document_id, temp_path)
        else:
            # Covers 'vanilla', 'contextual', and 'anthropic'
            process_document_task(document_id, temp_path)
            
        return {"message": f"Document processed successfully using {chunk_method} method", "document_id": document_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

@app.post("/api/rag/search")
async def search_documents(request: SearchRequest):
    """Searches Milvus for relevant chunks based on a query."""
    try:
        connect_milvus()
            
        query_embedding = get_embedding(request.query)
        if not query_embedding:
            raise HTTPException(status_code=500, detail="Failed to get embedding for query")
            
        collection = Collection(COLLECTION_NAME)
        collection.load()
        
        search_params = {"metric_type": "COSINE", "params": {"ef": 64}}
        expr = None
        if request.document_ids:
            # Filter by specific documents
            doc_ids_str = ",".join([f"'{d}'" for d in request.document_ids])
            expr = f"document_id in [{doc_ids_str}]"
            
        results = collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param=search_params,
            limit=request.limit,
            expr=expr,
            output_fields=["document_id", "text"]
        )
        
        chunks = []
        for hits in results:
            for hit in hits:
                chunks.append({
                    "id": hit.id,
                    "document_id": hit.entity.get("document_id"),
                    "text": hit.entity.get("text"),
                    "score": hit.distance
                })
                
        return {"results": chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rag/delete")
async def delete_document(request: DeleteRequest):
    """Deletes vectors for a specific document_id."""
    try:
        connect_milvus()
        
        if not utility.has_collection(COLLECTION_NAME):
            return {"message": f"No collection exists yet, nothing to delete for {request.document_id}"}
            
        collection = Collection(COLLECTION_NAME)
        collection.load()
        expr = f"document_id == '{request.document_id}'"
        collection.delete(expr)
        collection.flush()
        
        return {"message": f"Successfully deleted vectors for document {request.document_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rag/chunks")
async def get_document_chunks(document_id: str, limit: int = 100, offset: int = 0):
    """Retrieves all stored text chunks for a specific document_id from Milvus."""
    try:
        connect_milvus()
        
        if not utility.has_collection(COLLECTION_NAME):
            return {"chunks": [], "total": 0}
            
        collection = Collection(COLLECTION_NAME)
        collection.load()
        
        # Query chunks for this document
        results = collection.query(
            expr=f"document_id == '{document_id}'",
            output_fields=["id", "document_id", "text"],
            limit=limit,
            offset=offset,
        )
        
        # Get total count
        count_results = collection.query(
            expr=f"document_id == '{document_id}'",
            output_fields=["id"],
        )
        
        chunks = [{"id": r["id"], "text": r["text"]} for r in results]
        
        return {"chunks": chunks, "total": len(count_results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok"}
