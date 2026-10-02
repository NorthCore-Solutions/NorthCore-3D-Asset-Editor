type EditorReturnControlProps = {
  collapsed: boolean;
  onToggle: () => void;
  onExit: () => void;
};

export function EditorReturnControl({ collapsed, onToggle, onExit }: EditorReturnControlProps) {
  if (collapsed) {
    return (
      <div className="editor-return-control is-collapsed">
        <button
          className="editor-return-toggle"
          type="button"
          aria-label="Editor-Auswahl einblenden"
          title="Editor-Auswahl einblenden"
          onClick={onToggle}
        >
          ›
        </button>
      </div>
    );
  }

  return (
    <div className="editor-return-control">
      <button className="editor-return-action" type="button" onClick={onExit}>
        ‹ Editor-Auswahl
      </button>
      <button
        className="editor-return-toggle"
        type="button"
        aria-label="Editor-Auswahl einklappen"
        title="Editor-Auswahl einklappen"
        onClick={onToggle}
      >
        ‹
      </button>
    </div>
  );
}
