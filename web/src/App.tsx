// App shell: a global Play/Review switch over the two views. The manifest is
// initialised once here (not in PlayView) so toggling views never re-inits / wipes
// an in-progress game.

import { useEffect, useRef } from "react";
import { useStore } from "./state/store";
import { GlobalNav } from "./components/GlobalNav";
import { PlayView } from "./components/PlayView";
import { ReviewView } from "./components/review/ReviewView";
import { AnalyzerView } from "./components/analyzer/AnalyzerView";

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    useStore.getState().init();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <GlobalNav view={view} onView={setView} />
      {view === "play" ? (
        <PlayView />
      ) : view === "review" ? (
        <ReviewView />
      ) : (
        <AnalyzerView />
      )}
    </div>
  );
}
