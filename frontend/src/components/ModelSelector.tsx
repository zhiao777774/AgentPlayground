
import type { Model } from '../types/index';
import { ChevronDown } from 'lucide-react';

interface Props {
    models: Model[];
    selectedModelId: string | undefined;
    onSelect: (id: string) => void;
    isLoading?: boolean;
    disabled?: boolean;
}

export function ModelSelector({ models, selectedModelId, onSelect, isLoading, disabled }: Props) {
    if (isLoading) {
        return (
            <div className="flex items-center space-x-2 animate-pulse bg-white/5 px-4 py-2 rounded-lg border border-white/10">
                <div className="h-4 w-24 bg-white/20 rounded"></div>
                <ChevronDown className="w-4 h-4 text-white/40" />
            </div>
        );
    }

    return (
        <div className="relative group z-10">
            <select
                value={selectedModelId || ''}
                onChange={(e) => onSelect(e.target.value)}
                disabled={disabled || isLoading}
                className="appearance-none bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-900 dark:text-white pl-4 pr-10 py-2 rounded-lg border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shadow-sm cursor-pointer min-w-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <option value="" disabled className="text-gray-500">
                    Select a Model
                </option>
                {models.map((m) => (
                    <option key={m.id} value={m.id} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                        {m.name} ({m.provider})
                    </option>
                ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-white/50 group-hover:text-gray-700 dark:group-hover:text-white transition-colors">
                <ChevronDown className="w-4 h-4" />
            </div>
        </div>
    );
}
