export function MemoryTab() {
  return (
    <div className="tab-body">
      <p className="placeholder">
        <strong>No memory in this round.</strong> Each message is independent: the model only
        sees the system prompt and your latest message.
      </p>
      <p className="note">Conversation memory arrives in Round 3.</p>
    </div>
  )
}
