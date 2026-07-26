import { useState } from 'react'
import { Swords, MailCheck } from 'lucide-react'

// Placeholder auth: no real email is sent yet. This is the UI to wire up to
// Supabase magic-link auth (supabase.auth.signInWithOtp) later.
export default function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-80 bg-neutral-900 border border-neutral-800 rounded-xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center mb-2.5">
            <Swords size={20} className="text-blue-400" />
          </div>
          <span className="text-white font-medium">Delve</span>
          <p className="text-xs text-neutral-400 mt-1">Sign in to join a campaign</p>
        </div>

        {!sent ? (
          <form onSubmit={submit}>
            <label className="text-xs text-neutral-400 block mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white mb-3"
            />
            <button
              type="submit"
              className="w-full bg-blue-500 hover:bg-blue-400 text-white text-sm rounded-md py-2"
            >
              Send sign-in link
            </button>
            <div className="mt-4 pt-3.5 border-t border-neutral-800 flex items-start gap-2">
              <MailCheck size={15} className="text-green-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-neutral-400">
                No password to remember — we'll email you a link that signs you in instantly.
              </p>
            </div>
          </form>
        ) : (
          <div className="text-center">
            <MailCheck size={28} className="text-green-500 mx-auto mb-3" />
            <p className="text-sm text-white mb-1.5">Check your email</p>
            <p className="text-xs text-neutral-400 mb-4">
              We sent a sign-in link to {email}.
            </p>
            {/* Demo-only shortcut since no real email goes out yet */}
            <button
              onClick={() => onSignedIn && onSignedIn(email)}
              className="text-xs border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              Continue (demo)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
