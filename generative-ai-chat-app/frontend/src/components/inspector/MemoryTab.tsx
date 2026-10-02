export function MemoryTab() {
  return (
    <div className="tab-body">
      <p className="placeholder">
        <strong>No memory in this round.</strong> Every request is sent without a{' '}
        <code>previous_response_id</code>, so the model only sees the instructions and your latest
        message.
      </p>
      <p className="note">Conversation memory arrives in Round 3.</p>
    </div>
  )
}
