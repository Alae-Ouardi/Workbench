interface ProjectDoneBannerProps {
  projectName: string;
  onDismiss: () => void;
}

export function ProjectDoneBanner({ projectName, onDismiss }: ProjectDoneBannerProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300">
      <span>🎉 Project complete — {projectName}. All tasks are done.</span>
      <button
        onClick={onDismiss}
        className="text-lg leading-none text-emerald-400/70 hover:text-emerald-200"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
