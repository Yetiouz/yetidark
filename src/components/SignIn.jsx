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
      <div className="w-80 bg-neutral-900 border border-neutral-800 rounded-xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center mb-2.5">
            <Swords size={20} className="text-blue-400" />
          </div>
          <span className="text-white font-medium">Delve</span>
          <p className="text-xs text-neutral-400 mt-1">Sign in to join a campaign</p>
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
              <div className="h-px flex-1 bg-neutral-800" />
              <span className="text-[11px] uppercase tracking-wider text-neutral-500">or email</span>
              <div className="h-px flex-1 bg-neutral-800" />
            </div>

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
                disabled={sending || githubLoading}
                className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm rounded-md py-2"
              >
                {sending ? 'Sending...' : 'Send sign-in link'}
              </button>
            </form>

            {error && (
              <div className="mt-3 flex items-start gap-2 text-red-400">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <p className="text-xs">{error}</p>
              </div>
            )}
            <div className="mt-4 pt-3.5 border-t border-neutral-800 flex items-start gap-2">
              <MailCheck size={15} className="text-green-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-neutral-400">
                No password to remember — we'll email you a link that signs you in instantly.
              </p>
            </div>
          </>
        ) : (
          <div className="text-center">
            <MailCheck size={28} className="text-green-500 mx-auto mb-3" />
            <p className="text-sm text-white mb-1.5">Check your email</p>
            <p className="text-xs text-neutral-400">
              We sent a sign-in link to {email}. Click it to come back here signed in.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
