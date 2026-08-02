import { useState } from 'react'
import { Swords, MailCheck, AlertCircle, Github } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const friendlyAuthError = (message) => {
  if (message?.toLowerCase().includes('rate limit')) {
    return 'Email sign-in is temporarily limited. Continue with GitHub instead.'
  }
  return message || 'Sign-in failed. Please try again.'
}

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [githubLoading, setGithubLoading] = useState(false)

  const signInWithGitHub = async () => {
    setGithubLoading(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    })

    if (signInError) {
      setGithubLoading(false)
      setError(friendlyAuthError(signInError.message))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setSending(false)
    if (signInError) {
      setError(friendlyAuthError(signInError.message))
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-80 bg-panel border border-line-soft rounded-xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-9 h-9 rounded-lg bg-primary-bg flex items-center justify-center mb-3">
            <Swords size={20} className="text-primary-text" />
          </div>
          <span className="text-ink font-medium">Delve</span>
          <p className="text-xs text-ink-dim mt-1">Sign in to join a campaign</p>
        </div>

        {!sent ? (
          <>
            <button
              type="button"
              onClick={signInWithGitHub}
              disabled={githubLoading || sending}
              className="w-full bg-white hover:bg-neutral-200 disabled:opacity-50 text-neutral-950 text-sm font-medium rounded-md py-2 flex items-center justify-center gap-2"
            >
              <Github size={16} />
              {githubLoading ? 'Connecting...' : 'Continue with GitHub'}
            </button>

            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-panel2" />
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">or email</span>
              <div className="h-px flex-1 bg-panel2" />
            </div>

            <form onSubmit={submit}>
              <label className="text-xs text-ink-dim block mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink mb-3"
              />
              <button
                type="submit"
                disabled={sending || githubLoading}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink text-sm rounded-md py-2"
              >
                {sending ? 'Sending...' : 'Send sign-in link'}
              </button>
            </form>

            {error && (
              <div className="mt-3 flex items-start gap-2 text-danger-text">
                <AlertCircle size={14} className="mt-1 flex-shrink-0" />
                <p className="text-xs">{error}</p>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-line-soft flex items-start gap-2">
              <MailCheck size={15} className="text-positive-text mt-1 flex-shrink-0" />
              <p className="text-xs text-ink-dim">
                No password to remember — we'll email you a link that signs you in instantly.
              </p>
            </div>
          </>
        ) : (
          <div className="text-center">
            <MailCheck size={28} className="text-positive-text mx-auto mb-3" />
            <p className="text-sm text-ink mb-2">Check your email</p>
            <p className="text-xs text-ink-dim">
              We sent a sign-in link to {email}. Click it to come back here signed in.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
