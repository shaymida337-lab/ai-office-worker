export type NatalieConversationStripProps = {
  placeholder?: string;
  suggestions?: string[];
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onSuggestionSelect?: (suggestion: string) => void;
  className?: string;
};

export function NatalieConversationStrip({
  placeholder = "מה תרצה שאעשה?",
  suggestions = [],
  value = "",
  onChange,
  onSubmit,
  onSuggestionSelect,
  className = "",
}: NatalieConversationStripProps) {
  return (
    <section className={className} aria-label="שיחה עם נטלי" data-natalie-surface="conversation-strip">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(value.trim());
        }}
      >
        <label htmlFor="natalie-conversation-input">{placeholder}</label>
        <input
          id="natalie-conversation-input"
          type="text"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          dir="rtl"
        />
        <button type="submit">שלח</button>
      </form>
      {suggestions.length > 0 && (
        <ul aria-label="הצעות לשאלה">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button type="button" onClick={() => onSuggestionSelect?.(suggestion)}>
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
