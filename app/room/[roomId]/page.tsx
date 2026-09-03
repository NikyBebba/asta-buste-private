'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Round = { id: string; player_name: string; status: string }
type Bid = { 
  id: string; 
  team_id: string; 
  participation: string; 
  commit_hash: string | null; 
  revealed_total: number | null; 
  revealed_player_given: string | null; 
  revealed_purchase_price: number | null; 
  revealed_extra_credits: number | null 
}

export default function RoomPage() {
  const { roomId } = useParams()
  const router = useRouter()
  const [teamId, setTeamId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [myBid, setMyBid] = useState<Bid | null>(null)
  const [playerGiven, setPlayerGiven] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [extraCredits, setExtraCredits] = useState('')
  const [loading, setLoading] = useState(false)
  const [allBids, setAllBids] = useState<Bid[]>([])
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    setTeamId(localStorage.getItem('team_id') || '')
    setTeamName(localStorage.getItem('team_name') || '')
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

  useEffect(() => {
    if (currentRound?.status === 'revealed' && myBid?.commit_hash && myBid.revealed_total === null) {
      revealMyBid()
    }
  }, [currentRound?.status])

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
    const { data } = await supabase.from('bids').select().eq('round_id', currentRound.id)
    if (data) setAllBids(data)
  }

  async function revealMyBid() {
    const localOffer = localStorage.getItem(`offer_${currentRound?.id}`)
    if (!localOffer || !myBid) return

    const { playerGiven, price, extra, total } = JSON.parse(localOffer)

    await supabase.from('bids').update({
      revealed_player_given: playerGiven,
      revealed_purchase_price: price,
      revealed_extra_credits: extra,
      revealed_total: total
    }).eq('id', myBid.id)

    loadMyBid()
    loadAllBids()
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
      sealed_at: new Date().toISOString(),
    }, { onConflict: 'round_id,team_id' })

    await loadMyBid()
    setLoading(false)
  }

  const total = (parseInt(purchasePrice) || 0) + (parseInt(extraCredits) || 0)

  // LOGICA TIE-BREAK PARI TOTALE E PARI EXTRA
  const validBids = allBids.filter(b => b.participation === 'joined' && b.revealed_total !== null)
  
  // Ordina le buste: prima per Totale DESC, poi per Crediti Extra DESC
  const sortedBids = [...validBids].sort((a, b) => {
    const totA = a.revealed_total ?? 0
    const totB = b.revealed_total ?? 0
    if (totB !== totA) return totB - totA

    const extraA = a.revealed_extra_credits ?? 0
    const extraB = b.revealed_extra_credits ?? 0
    return extraB - extraA
  })

  // Verifica se le prime due offerte sono in pareggio assoluto
  const isPerfectTie = sortedBids.length > 1 && 
    sortedBids[0].revealed_total === sortedBids[1].revealed_total && 
    sortedBids[0].revealed_extra_credits === sortedBids[1].revealed_extra_credits

  const winningBid = !isPerfectTie && sortedBids.length > 0 ? sortedBids[0] : null
  const isMyVictory = winningBid && winningBid.team_id === teamId
  const winningTeamName = teams.find(t => t.id === winningBid?.team_id)?.name

  if (!currentRound || currentRound.status === 'winner_declared') {
    return (
      <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <p className="text-3xl mb-3">⏳</p>
        <p className="text-gray-300 font-medium">In attesa del prossimo calciatore...</p>
        <p className="text-gray-500 text-xs mt-4">{teamName}</p>
        <button 
          onClick={() => router.push(`/room/${roomId}/history`)}
          className="mt-6 bg-gray-900 border border-gray-800 text-xs px-4 py-2 rounded-xl text-gray-300 active:scale-95 transition-transform select-none touch-manipulation"
        >
          📜 Consulta Storico Aggiudicazioni
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-4 max-w-lg mx-auto font-sans">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-gray-300 font-bold text-sm">{teamName}</p>
          <p className="text-gray-600 text-xs">{localStorage.getItem('room_code')}</p>
        </div>
        <button 
          onClick={() => router.push(`/room/${roomId}/history`)}
          className="bg-gray-900 border border-gray-800 text-xs px-3 py-2 rounded-xl text-gray-300 active:scale-95 transition-transform select-none touch-manipulation"
        >
          📜 Storico
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6 text-center">
        <p className="text-gray-400 text-xs mb-1">In asta</p>
        <p className="text-2xl font-bold">{currentRound.player_name}</p>
      </div>

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

      {currentRound.status === 'open_for_participation' && !myBid && (
        <div className="flex gap-3 mt-4">
          <button 
            onClick={participate} 
            disabled={loading} 
            className="flex-1 bg-white text-black font-bold py-4 rounded-xl active:scale-95 transition-transform select-none touch-manipulation"
          >
            ✅ Partecipa
          </button>
          <button 
            onClick={skip} 
            disabled={loading} 
            className="flex-1 border border-gray-600 text-white font-bold py-4 rounded-xl active:scale-95 transition-transform select-none touch-manipulation"
          >
            ⏭ Salta
          </button>
        </div>
      )}

      {currentRound.status === 'open_for_participation' && myBid?.participation === 'skipped' && (
        <p className="text-center text-gray-500 mt-4">Hai scelto di non partecipare a questo giocatore.</p>
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
            </div>
          )}
          <button
            onClick={sealBid}
            disabled={loading || !playerGiven || !purchasePrice}
            className="bg-red-600 text-white font-bold py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform select-none touch-manipulation"
          >
            🔒 Sigilla offerta
          </button>
        </div>
      )}

      {currentRound.status === 'open_for_participation' && myBid?.commit_hash && (
        <p className="text-center text-green-400 mt-4 font-bold">🟢 Offerta sigillata — attendi gli altri</p>
      )}

      {currentRound.status === 'closed' && (
        <p className="text-center text-yellow-400 mt-4">🔒 Turno chiuso — l'admin sta per aprire le buste</p>
      )}

      {currentRound.status === 'revealed' && (
        <div className="mt-4">
          {isPerfectTie ? (
            <div className="bg-amber-500/10 border-2 border-amber-500 rounded-2xl p-4 text-center mb-6">
              <p className="text-3xl mb-1">⚖️</p>
              <p className="text-amber-400 font-extrabold text-xl">PAREGGIO PERFETTO!</p>
              <p className="text-xs text-gray-300 mt-1">
                L'Admin sta assegnando manualmente il giocatore secondo regolamento.
              </p>
            </div>
          ) : winningBid ? (
            isMyVictory ? (
              <div className="bg-yellow-500/10 border-2 border-yellow-500 rounded-2xl p-4 text-center mb-6">
                <p className="text-3xl mb-1">🏆</p>
                <p className="text-yellow-400 font-extrabold text-xl">HAI VINTO IL GIOCATORE!</p>
                <p className="text-sm text-gray-300 mt-1">
                  Ti sei aggiudicato <span className="font-bold">{currentRound.player_name}</span> per <span className="font-bold text-yellow-400">{winningBid.revealed_total} cr</span>!
                </p>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center mb-6">
                <p className="text-xl mb-1">❌</p>
                <p className="text-gray-300 font-bold">Aggiudicato a {winningTeamName}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Offerta vincente: {winningBid.revealed_total} crediti ({winningBid.revealed_extra_credits ?? 0} extra)
                </p>
              </div>
            )
          ) : (
            <p className="text-center text-gray-500 mb-4">Nessuna offerta pervenuta.</p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">Squadra</th>
                <th className="text-left py-2">Ceduto</th>
                <th className="text-right py-2 font-mono">Extra</th>
                <th className="text-right py-2">Totale</th>
              </tr>
            </thead>
            <tbody>
              {sortedBids.map(bid => {
                const team = teams.find(t => t.id === bid.team_id)
                const isWinner = winningBid && bid.id === winningBid.id
                return (
                  <tr key={bid.team_id} className={`border-b border-gray-800 ${isWinner ? 'text-yellow-400 font-bold' : ''}`}>
                    <td className="py-2">{isWinner ? '🏆 ' : ''}{team?.name}</td>
                    <td className="py-2">{bid.revealed_player_given ? `${bid.revealed_player_given}` : '—'}</td>
                    <td className="py-2 text-right text-gray-400 text-xs font-mono">+{bid.revealed_extra_credits ?? 0}</td>
                    <td className="py-2 text-right">{bid.revealed_total !== null ? `${bid.revealed_total} cr` : '...'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}