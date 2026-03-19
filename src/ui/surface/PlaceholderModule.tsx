import type { ModuleRendererProps } from './ModuleRendererProps';

export function PlaceholderModule({ module }: ModuleRendererProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-2 select-none">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{module.type}</span>
      <span className="text-sm text-zinc-300 mt-1">{module.label}</span>
      {module.bindings.length > 0 && (
        <span className="text-xs text-zinc-600 mt-1">
          {module.bindings.map(b => b.target).join(', ')}
        </span>
      )}
    </div>
  );
}
