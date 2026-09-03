'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type HistoryItem = {
  id: string
  player_name: string
  winning_amount: number
  created_at: string
  teams: { name: string } | null
}

export default function HistoryPage() {
  const { roomId } = useParams()
  const router = useRouter()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadHistory()

    const historySub = supabase
      .channel('history-sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history', filter: `room_id=eq.${roomId}` }, loadHistory)
      .subscribe()

    return () => { supabase.removeChannel(historySub) }
  }, [roomId])

  async function loadHistory() {
    const { data } = await supabase
      .from('history')
      .select('id, player_name, winning_amount, created_at, teams(name)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })

    if (data) setHistory(data as unknown as HistoryItem[])
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-black text-white p-4 max-w-lg mx-auto font-sans">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => router.back()} className="text-gray-400 text-sm flex items-center gap-1">
          ← Indietro
        </button>
        <h1 className="text-lg font-bold">📜 Storico Asta</h1>
        <div className="w-8"></div>
      </div>

      {loading ? (
        <p className="text-center text-gray-500 mt-8">Caricamento...</p>
      ) : history.length === 0 ? (
        <p className="text-center text-gray-500 mt-8">Nessun giocatore aggiudicato finora.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map(item => (
            <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="font-bold text-lg text-white">{item.player_name}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Vinto da <span className="text-white font-medium">{item.teams?.name || 'Sconosciuto'}</span>
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-yellow-400">{item.winning_amount}</span>
                <span className="text-xs text-gray-500 block">cr</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}