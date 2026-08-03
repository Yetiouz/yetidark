import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, FileText, Link as LinkIcon, Trash2, ExternalLink, Search } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Tabs from './ui/Tabs.jsx'
import { CLASSES, STANDARD_DCS, DISTANCES, MOVEMENT_RULES } from '../game/rules/content.js'

// The design mockup for this screen (design-handoff-spec Section 4.11)
// imagines a searchable database of individual rules/spells/talents, with
// campaign house-rule overrides called out inline next to the official
// text. That's not what exists: rules_documents is a shelf of whole
// uploaded files or links, and house rules are one freeform text blob on
// the campaign (CampaignSettings.jsx), not tied to any specific rule.
// Building the mockup's real vision would mean transcribing the rulebook
// and Cursed Scrolls into hundreds of structured, individually-searchable
// entries -- a copyright problem for paid content, and a much bigger
// project than this pass. What's built here instead is a real polish of
// what actually exists: search and category filtering over the documents
// themselves, not their contents.
const CATEGORY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'file', label: 'Files' },
  { key: 'link', label: 'Links' },
]

const MODE_TABS = [
  { key: 'documents', label: 'Documents' },
  { key: 'quickref', label: 'Quick Reference' },
]

// Lightweight, structured rules lookup -- the thing "Ask a rule" actually
// promises but this screen never delivered: standard DCs, movement/distance,
// and a browsable class reference (features + talent table), all sourced
// from src/game/rules/content.js rather than duplicated here. Deliberately
// not the mockup's searchable-corpus vision (see the file header comment
// above) -- just the small, honest slice persona-analysis called out as the
// real in-session friction point.
const QUICKREF_TABS = [
  { key: 'dcs', label: 'Standard DCs' },
  { key: 'movement', label: 'Movement & Distance' },
  { key: 'classes', label: 'Classes' },
]

// Reference material (core rulebook, supplements, adventures) -- distinct
// from CampaignSettings.jsx's House Rules box, which is the table's own
// homebrew. A document is owned by the GM who added it and shared with
// everyone across *that GM's* campaigns for the matching system, not with
// every Delve user (see 009_rules_library.sql) -- some of this is paid
// content the GM doesn't have the right to redistribute more broadly than
// their own table.
//
// Two kinds of entry: an uploaded file (private storage bucket, opened via
// a short-lived signed URL) for anything freely shareable, or a plain
// external link for commercial material the GM would rather point to than
// host a copy of.
export default function RulesLibrary({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [isGm, setIsGm] = useState(false)
  const [system, setSystem] = useState('Shadowdark')
  const [gmUserId, setGmUserId] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const [mode, setMode] = useState('documents')
  const [qrTab, setQrTab] = useState('dcs')
  const [myCharacters, setMyCharacters] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)

  const [showAdd, setShowAdd] = useState(false)
  const [addKind, setAddKind] = useState('file') // 'file' | 'link'
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [addError, setAddError] = useState(null)
  const fileInputRef = useRef(null)

  const loadDocs = async (owner, sys) => {
    const { data, error: docsError } = await supabase
      .from('rules_documents')
      .select('id, title, description, kind, file_path, external_url, created_at')
      .eq('owner_user_id', owner)
      .eq('system', sys)
      .order('created_at', { ascending: true })
    if (docsError) {
      setError(docsError.message)
      return
    }
    setDocs(data || [])
  }

  useEffect(() => {
    if (!campaignId || !user) return
    let cancelled = false

    supabase
      .from('campaigns')
      .select('system, gm_user_id')
      .eq('id', campaignId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !data) return
        setSystem(data.system)
        setGmUserId(data.gm_user_id)
        await loadDocs(data.gm_user_id, data.system)
        setLoading(false)
      })

    supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setIsGm(data?.role === 'gm')
      })

    return () => {
      cancelled = true
    }
  }, [campaignId, user])

  // Same query CharacterPicker.jsx already uses to list "my characters in
  // this campaign" -- reused here only to default the Classes tab to the
  // viewer's own class, not to duplicate character-picking UI.
  useEffect(() => {
    if (!campaignId || !user) return
    let cancelled = false
    supabase
      .from('characters')
      .select('id, name, class')
      .eq('campaign_id', campaignId)
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setMyCharacters(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, user])

  useEffect(() => {
    if (selectedClass) return
    const ownClass = myCharacters[0]?.class
    setSelectedClass(ownClass && CLASSES.some((c) => c.name === ownClass) ? ownClass : CLASSES[0]?.name || null)
  }, [myCharacters, selectedClass])

  const openDoc = async (doc) => {
    if (doc.kind === 'link') {
      window.open(doc.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    const { data, error: signError } = await supabase.storage.from('rules').createSignedUrl(doc.file_path, 60)
    if (signError || !data) {
      setError(signError?.message || 'Could not open that file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const resetAddForm = () => {
    setTitleDraft('')
    setDescDraft('')
    setUrlDraft('')
    setAddError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addLinkDoc = async () => {
    if (!titleDraft.trim() || !urlDraft.trim() || !user) return
    setUploading(true)
    setAddError(null)
    const { error: insertError } = await supabase.from('rules_documents').insert({
      owner_user_id: user.id,
      system,
      title: titleDraft.trim(),
      description: descDraft.trim() || null,
      kind: 'link',
      external_url: urlDraft.trim(),
    })
    setUploading(false)
    if (insertError) {
      setAddError(insertError.message)
      return
    }
    resetAddForm()
    setShowAdd(false)
    loadDocs(gmUserId, system)
  }

  const addFileDoc = async (file) => {
    if (!file || !titleDraft.trim() || !user) return
    setUploading(true)
    setAddError(null)
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`
    const { error: storageError } = await supabase.storage.from('rules').upload(path, file)
    if (storageError) {
      setUploading(false)
      setAddError(storageError.message)
      return
    }
    const { error: insertError } = await supabase.from('rules_documents').insert({
      owner_user_id: user.id,
      system,
      title: titleDraft.trim(),
      description: descDraft.trim() || null,
      kind: 'file',
      file_path: path,
    })
    setUploading(false)
    if (insertError) {
      setAddError(insertError.message)
      return
    }
    resetAddForm()
    setShowAdd(false)
    loadDocs(gmUserId, system)
  }

  const deleteDoc = async (doc) => {
    if (!window.confirm(`Remove "${doc.title}" from the library?`)) return
    if (doc.kind === 'file' && doc.file_path) {
      await supabase.storage.from('rules').remove([doc.file_path])
    }
    await supabase.from('rules_documents').delete().eq('id', doc.id)
    loadDocs(gmUserId, system)
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading rules library…</p>
      </div>
    )
  }

  const filteredDocs = docs.filter((doc) => {
    if (category !== 'all' && doc.kind !== category) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return doc.title.toLowerCase().includes(q) || (doc.description || '').toLowerCase().includes(q)
  })
  const isFiltering = category !== 'all' || query.trim().length > 0

  return (
    <div className="max-w-2xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-ink text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-ink-dim mb-4">
        Rules library &middot; {system} &middot; shared across this GM's {system} campaigns
      </p>

      {error && <p className="text-xs text-danger-text mb-3">{error}</p>}

      <Tabs tabs={MODE_TABS} activeKey={mode} onChange={setMode} />

      {mode === 'documents' && (
      <>
      {docs.length > 0 && (
        <div className="mb-4">
          <div className="relative mb-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this library by title or description"
              className="w-full text-xs bg-bg border border-line rounded-md pl-8 pr-3 py-2 text-ink"
            />
          </div>
          <Tabs tabs={CATEGORY_TABS} activeKey={category} onChange={setCategory} />
        </div>
      )}

      {isGm && (
        <div className="mb-4">
          <button
            onClick={() => {
              setShowAdd((s) => !s)
              resetAddForm()
            }}
            className="text-xs border border-line rounded-md px-3 py-2 flex items-center gap-2 text-ink hover:bg-panel2"
          >
            <Plus size={13} /> Add reference
          </button>

          {showAdd && (
            <div className="mt-3 bg-panel border border-line-soft rounded-xl p-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setAddKind('file')}
                  className={`flex-1 text-xs py-2 rounded-md border ${
                    addKind === 'file' ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim'
                  }`}
                >
                  Upload file
                </button>
                <button
                  onClick={() => setAddKind('link')}
                  className={`flex-1 text-xs py-2 rounded-md border ${
                    addKind === 'link' ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim'
                  }`}
                >
                  Add link
                </button>
              </div>
              <p className="text-[11px] text-ink-faint">
                {addKind === 'file'
                  ? 'Only upload things you have the right to share with your table -- free/quickstart material, your own homebrew writeups, etc.'
                  : "For commercial material (core rulebook, paid supplements), link to where players can get their own copy instead of hosting it here."}
              </p>

              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Title (e.g. Shadowdark Quickstart Set)"
                className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
              />
              <input
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Description (optional)"
                className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
              />

              {addKind === 'file' ? (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                  onChange={(e) => addFileDoc(e.target.files?.[0])}
                  disabled={uploading || !titleDraft.trim()}
                  className="text-xs text-ink-dim"
                />
              ) : (
                <div className="flex gap-2">
                  <input
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                  />
                  <button
                    onClick={addLinkDoc}
                    disabled={uploading || !titleDraft.trim() || !urlDraft.trim()}
                    className="text-xs border border-line rounded-md px-3 py-2 text-ink hover:bg-panel2 disabled:opacity-50"
                  >
                    {uploading ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}

              {addKind === 'file' && !titleDraft.trim() && (
                <p className="text-[11px] text-ink-faint">Enter a title above, then choose a file.</p>
              )}
              {addError && <p className="text-xs text-danger-text">{addError}</p>}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {docs.length === 0 && (
          <p className="text-xs text-ink-faint">
            {isGm ? 'No reference material yet -- add one above.' : 'The GM hasn\'t added any reference material yet.'}
          </p>
        )}
        {docs.length > 0 && filteredDocs.length === 0 && (
          <p className="text-xs text-ink-faint">
            {isFiltering ? (
              query.trim() ? <>No matches for &ldquo;{query.trim()}&rdquo;.</> : 'No results in this category.'
            ) : (
              'No reference material yet.'
            )}
          </p>
        )}
        {filteredDocs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-2 bg-panel border border-line-soft rounded-lg p-3"
          >
            <button onClick={() => openDoc(doc)} className="flex items-start gap-3 text-left flex-1 min-w-0">
              <div className="w-7 h-7 rounded-md bg-panel2 flex items-center justify-center shrink-0 mt-1">
                {doc.kind === 'file' ? (
                  <FileText size={14} className="text-ink-dim" />
                ) : (
                  <LinkIcon size={14} className="text-ink-dim" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-ink truncate flex items-center gap-2">
                  {doc.title}
                  {doc.kind === 'link' && <ExternalLink size={11} className="text-ink-faint shrink-0" />}
                </p>
                {doc.description && <p className="text-xs text-ink-faint truncate">{doc.description}</p>}
              </div>
            </button>
            {isGm && (
              <button
                onClick={() => deleteDoc(doc)}
                title="Remove"
                className="text-ink-faint hover:text-danger-text shrink-0 p-1"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      </>
      )}

      {mode === 'quickref' && (
        <div>
          <Tabs tabs={QUICKREF_TABS} activeKey={qrTab} onChange={setQrTab} />

          {qrTab === 'dcs' && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-ink-faint mb-1">
                The GM calls for a check when the action has a real chance of failure, requires skill, or there&rsquo;s time pressure.
              </p>
              {STANDARD_DCS.map((row) => (
                <div key={row.label} className="bg-panel border border-line-soft rounded-lg p-3">
                  <p className="text-sm text-ink flex items-center gap-2">
                    {row.label} <span className="text-ink-faint text-xs">DC {row.dc}</span>
                  </p>
                  <p className="text-xs text-ink-faint mt-1">{row.examples}</p>
                </div>
              ))}
            </div>
          )}

          {qrTab === 'movement' && (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs text-ink-dim mb-2">Distances</p>
                <div className="flex flex-col gap-2">
                  {DISTANCES.map((d) => (
                    <div key={d.label} className="bg-panel border border-line-soft rounded-lg p-3">
                      <p className="text-sm text-ink">{d.label}</p>
                      <p className="text-xs text-ink-faint mt-1">{d.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-ink-dim mb-2">Movement</p>
                <div className="flex flex-col gap-2">
                  {MOVEMENT_RULES.map((m) => (
                    <div key={m.name} className="bg-panel border border-line-soft rounded-lg p-3">
                      <p className="text-sm text-ink">{m.name}</p>
                      <p className="text-xs text-ink-faint mt-1">{m.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {qrTab === 'classes' && (
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                {CLASSES.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedClass(c.name)}
                    className={`text-xs rounded-md px-3 py-1.5 border ${
                      selectedClass === c.name ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim'
                    }`}
                  >
                    {c.name}
                    {myCharacters.some((ch) => ch.class === c.name) && (
                      <span className="text-primary-text"> &middot; yours</span>
                    )}
                  </button>
                ))}
              </div>
              {(() => {
                const cls = CLASSES.find((c) => c.name === selectedClass)
                if (!cls) return null
                return (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-ink-faint">{cls.blurb}</p>
                    <div>
                      <p className="text-xs text-ink-dim mb-2">Features</p>
                      <div className="flex flex-col gap-2">
                        {cls.features.map((f) => (
                          <div key={f.name} className="bg-panel border border-line-soft rounded-lg p-3">
                            <p className="text-sm text-ink">{f.name}</p>
                            <p className="text-xs text-ink-faint mt-1">{f.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-ink-dim mb-2">Talent table (2d6, gained at levels 1/3/5/7/9)</p>
                      <div className="flex flex-col gap-1">
                        {cls.talentTable.map((t) => (
                          <div
                            key={`${t.min}-${t.max}`}
                            className="flex items-start gap-3 bg-panel border border-line-soft rounded-lg p-3"
                          >
                            <span className="text-xs text-ink-faint w-10 shrink-0">
                              {t.min === t.max ? t.min : `${t.min}-${t.max}`}
                            </span>
                            <span className="text-xs text-ink">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
