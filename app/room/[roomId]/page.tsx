'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Round = { id: string; player_name: string; status: string }
type Bid = { id: string; participation: string; commit_hash: string | null; revealed_total: number | null; revealed_player_given: string | null }

export default function RoomPage() {
  const { roomId } = useParams()
  const [teamId, setTeamId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [myBid, setMyBid] = useState<Bid | null>(null)
  const [playerGiven, setPlayerGiven] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [extraCredits, setExtraCredits] = useState('')
  const [loading, setLoading] = useState(false)
  const [allBids, setAllBids] = useState<{team_id: string, participation: string, commit_hash: string | null}[]>([])
  const [teams, setTeams] = useState<{id: string, name: string}[]>([])

  useEffect(() => {
    const tid = localStorage.getItem('team_id') || ''
    const tname = localStorage.getItem('team_name') || ''
    setTeamId(tid)
    setTeamName(tname)
    loadTeams()
    loadCurrentRound()

    const roundsSub = supabase
      .channel('rounds-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_rounds', filter: `room_id=eq.${roomId}` }, loadCurrentRound)
      .subscribe()

    const teamsSub = supabase
      .channel('teams-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `room_id=eq.${roomId}` }, loadTeams)
      .subscribe()

    return () => {
      supabase.removeChannel(roundsSub)
      supabase.removeChannel(teamsSub)
    }
  }, [roomId])

  useEffect(() => {
    if (!currentRound || !teamId) return
    loadMyBid()
    loadAllBids()

    const bidsSub = supabase
      .channel('bids-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `round_id=eq.${currentRound.id}` }, () => {
        loadMyBid()
        loadAllBids()
      })
      .subscribe()

    return () => { supabase.removeChannel(bidsSub) }
  }, [currentRound?.id, teamId])

  async function loadTeams() {
    const { data } = await supabase.from('teams').select().eq('room_id', roomId).order('joined_at')
    if (data) setTeams(data)
  }

  async function loadCurrentRound() {
    const { data } = await supabase
      .from('auction_rounds')
      .select()
      .eq('room_id', roomId)
      .order('round_number', { ascending: false })
      .limit(1)
      .single()
    if (data) setCurrentRound(data)
    else setCurrentRound(null)
  }

  async function loadMyBid() {
    if (!currentRound || !teamId) return
    const { data } = await supabase.from('bids').select().eq('round_id', currentRound.id).eq('team_id', teamId).single()
    if (data) setMyBid(data)
    else setMyBid(null)
  }

  async function loadAllBids() {
    if (!currentRound) return
    const { data } = await supabase.from('bids').select('team_id, participation, commit_hash').eq('round_id', currentRound.id)
    if (data) setAllBids(data)
  }

  async function participate() {
    if (!currentRound || !teamId) return
    setLoading(true)
    const { data } = await supabase
      .from('bids')
      .upsert({ round_id: currentRound.id, team_id: teamId, participation: 'joined' }, { onConflict: 'round_id,team_id' })
      .select()
      .single()
    if (data) setMyBid(data)
    setLoading(false)
  }

  async function skip() {
    if (!currentRound || !teamId) return
    setLoading(true)
    const { data } = await supabase
      .from('bids')
      .upsert({ round_id: currentRound.id, team_id: teamId, participation: 'skipped' }, { onConflict: 'round_id,team_id' })
      .select()
      .single()
    if (data) setMyBid(data)
    setLoading(false)
  }

  async function sealBid() {
    if (!currentRound || !teamId || !playerGiven || !purchasePrice) return
    setLoading(true)

    const price = parseInt(purchasePrice)
    const extra = parseInt(extraCredits) || 0
    const total = price + extra

    const secret = crypto.randomUUID()
    const payload = `${playerGiven}|${price}|${extra}|${secret}`
    const encoded = new TextEncoder().encode(payload)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    localStorage.setItem(`secret_${currentRound.id}`, secret)
    localStorage.setItem(`offer_${currentRound.id}`, JSON.stringify({ playerGiven, price, extra, total }))

    await supabase.from('bids').upsert({
      round_id: currentRound.id,
      team_id: teamId,
      participation: 'joined',
      commit_hash: hashHex,
      revealed_player_given: playerGiven,
      revealed_purchase_price: price,
      revealed_extra_credits: extra,
      revealed_total: total,
      sealed_at: new Date().toISOString(),
    }, { onConflict: 'round_id,team_id' })

    await loadMyBid()
    setLoading(false)
  }

  const total = (parseInt(purchasePrice) || 0) + (parseInt(extraCredits) || 0)

  if (!currentRound || currentRound.status === 'winner_declared') {
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
        <p className="text-2xl mb-2">⏳</p>
        <p className="text-gray-400">In attesa del prossimo giocatore...</p>
        <p className="text-gray-600 text-sm mt-4">{teamName}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <p className="text-gray-400 text-sm">{teamName}</p>
        <p className="text-gray-600 text-xs">{localStorage.getItem('room_code')}</p>
      </div>

      <div className="bg-gray-900 rounded-2xl p-4 mb-6 text-center">
        <p className="text-gray-400 text-xs mb-1">In asta</p>
        <p className="text-2xl font-bold">{currentRound.player_name}</p>
      </div>

      {/* Stato offerte altrui */}
      {currentRound.status === 'open_for_participation' && (
        <div className="mb-4">
          {teams.map(t => {
            const bid = allBids.find(b => b.team_id === t.id)
            return (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-800 text-sm">
                <span>{t.name}</span>
                {!bid || bid.participation === 'pending' ? <span className="text-gray-500">⏳</span>
                  : bid.participation === 'skipped' ? <span className="text-gray-500">⚪ salta</span>
                  : bid.commit_hash ? <span className="text-green-400">🟢 sigillata</span>
                  : <span className="text-yellow-400">🟡 partecipa</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Azione squadra */}
      {currentRound.status === 'open_for_participation' && !myBid && (
        <div className="flex gap-3 mt-4">
          <button onClick={participate} disabled={loading} className="flex-1 bg-white text-black font-bold py-4 rounded-xl">
            ✅ Partecipa
          </button>
          <button onClick={skip} disabled={loading} className="flex-1 border border-gray-600 text-white font-bold py-4 rounded-xl">
            ⏭ Salta
          </button>
        </div>
      )}

      {currentRound.status === 'open_for_participation' && myBid?.participation === 'skipped' && (
        <p className="text-center text-gray-500 mt-4">Hai saltato questo giocatore.</p>
      )}

      {currentRound.status === 'open_for_participation' && myBid?.participation === 'joined' && !myBid.commit_hash && (
        <div className="flex flex-col gap-3 mt-4">
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
            placeholder="Giocatore da cedere"
            value={playerGiven}
            onChange={e => setPlayerGiven(e.target.value)}
          />
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
            placeholder="Prezzo acquisto"
            type="number"
            value={purchasePrice}
            onChange={e => setPurchasePrice(e.target.value)}
          />
          <input
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500"
            placeholder="Crediti aggiuntivi"
            type="number"
            value={extraCredits}
            onChange={e => setExtraCredits(e.target.value)}
          />
          {purchasePrice && (
            <div className="bg-gray-800 rounded-xl p-3 text-center">
              <p className="text-gray-400 text-sm">Offerta totale</p>
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-gray-500 text-xs">{playerGiven || '—'} ({purchasePrice || 0}) + {extraCredits || 0} crediti</p>
            </div>
          )}
          <button
            onClick={sealBid}
            disabled={loading || !playerGiven || !purchasePrice}
            className="bg-red-600 text-white font-bold py-4 rounded-xl text-lg disabled:opacity-50"
          >
            🔒 Sigilla offerta
          </button>
        </div>
      )}

      {currentRound.status === 'open_for_participation' && myBid?.commit_hash && (
        <p className="text-center text-green-400 mt-4 font-bold">🟢 Offerta sigillata — attendi gli altri</p>
      )}

      {currentRound.status === 'closed' && (
        <p className="text-center text-yellow-400 mt-4">🔒 Turno chiuso — l'admin sta per aprire le offerte</p>
      )}

      {currentRound.status === 'revealed' && (
        <div className="mt-4">
          <p className="text-center text-yellow-400 font-bold mb-4">🔓 Offerte aperte</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800">
                  <th className="text-left py-2">Squadra</th>
                  <th className="text-left py-2">Ceduto</th>
                  <th className="text-right py-2">Offerta</th>
                </tr>
              </thead>
              <tbody>
                {allBids.filter(b => b.participation === 'joined').map(bid => {
                  const team = teams.find(t => t.id === bid.team_id)
                  return (
                    <tr key={bid.team_id} className="border-b border-gray-800">
                      <td className="py-2">{team?.name}</td>
                      <td className="py-2">—</td>
                      <td className="py-2 text-right">—</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}