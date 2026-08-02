import Modal from './Modal.jsx'
import Button from './Button.jsx'

// Minimal Modal.jsx-based confirm dialog -- the codebase had no shared
// confirm pattern before this. Row deletes elsewhere fire immediately with
// no confirmation at all (CampaignTracker.jsx's deleteRow, CharacterSheet.jsx's
// removeGear/removeFeature/removeSpell, Profile.jsx's leaveCampaign), and the
// one existing confirmation (GmDashboard.jsx's removeMap) uses a raw
// window.confirm rather than an in-app dialog. GmDashboard.jsx's
// encounter-monster delete (Bug #4) is the first real use of this component;
// built generic (title/message/confirm label/variant) so other consequential
// actions can reuse it instead of window.confirm or a hand-rolled dialog --
// Profile.jsx's leaveCampaign is a good next candidate, tracked separately
// rather than fixed here.
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  confirming = false,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {message && <p className="text-sm text-ink-dim">{message}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={confirming}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
