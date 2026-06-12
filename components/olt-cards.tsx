'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, X, AlertTriangle, Loader2 } from 'lucide-react'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'
import OLTSelector from './olt-selector'

interface OLTCard {
  id: string
  rack: number
  shelf: number
  slot: number
  configuredType: string
  cardName: string
  port: number
  hardwareVersion: string
  softwareVersion: string
  status: string
  cfgStatus: string
}



const cardTypes = [
  'GTGO',
  'GTGH',
  'ETGO',
  'ETGH',
  'SCXN',
  'PRWH',
  'HUVQ',
  'SMXA',
]

const oltIdToName: Record<string, string> = {
  'c600': 'ZTE C600',
  'c300': 'ZTE C300',
  'c320': 'ZTE C320'
}

interface OLTCardsProps {
  userRole: 'admin' | 'guest'
  selectedOLT: string
  onOLTChange: (oltId: string) => void
}

export default function OLTCards({ userRole, selectedOLT, onOLTChange }: OLTCardsProps) {
  const { connectionState } = useNetworkAgent()
  const isMatch = connectionState === 'MATCH'
  
  const [cards, setCards] = useState<OLTCard[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Fetch real cards when state is MATCH
  useEffect(() => {
    if (isMatch) {
      const fetchCards = async () => {
        setIsLoading(true)
        try {
          
          const res = await fetch(`/api/olt/cards`)
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
          const data = await res.json()
          if (data && Array.isArray(data)) {
             setCards(data)
          } else {
             setCards([])
          }
        } catch (e) {
          // Use warn instead of error to prevent Next.js dev overlay
          console.warn("OLTCards: Backend unreachable or returned error", e)
        } finally {
          setIsLoading(false)
        }
      }
      fetchCards()
    } else {
      setCards([])
      setSelectedCards([])
    }
  }, [isMatch, selectedOLT])

  // Add Card Form State
  const [newSlotNumber, setNewSlotNumber] = useState<number>(1)
  const [newCardType, setNewCardType] = useState<string>('')

  const getStatusStyle = (status: OLTCard['status']) => {
    switch (status) {
      case 'INSERVICE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'CONFIGING':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'CONFIGFAILED':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'DISABLE':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      case 'HWONLINE':
        return 'bg-cyan-100 text-cyan-800 border-cyan-200'
      case 'OFFLINE':
        return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'STANDBY':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'TYPEMISMATCH':
        return 'bg-purple-100 text-purple-800 border-purple-200'
      case 'NOPOWER':
        return 'bg-gray-200 text-gray-600 border-gray-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCards(cards.map(card => card.id))
    } else {
      setSelectedCards([])
    }
  }

  const handleSelectCard = (cardId: string, checked: boolean) => {
    if (checked) {
      setSelectedCards([...selectedCards, cardId])
    } else {
      setSelectedCards(selectedCards.filter(id => id !== cardId))
    }
  }

  const handleAddCard = () => {
    // Check if slot is already occupied
    if (cards.some(card => card.slot === newSlotNumber)) {
      alert(`Slot ${newSlotNumber} is already occupied`)
      return
    }

    const newCard: OLTCard = {
      id: Date.now().toString(),
      rack: 1,
      shelf: 1,
      slot: newSlotNumber,
      configuredType: newCardType,
      cardName: `${newCardType}-NEW`,
      port: newCardType.startsWith('GT') ? 16 : newCardType.startsWith('ET') ? 8 : 2,
      hardwareVersion: 'V1.0',
      softwareVersion: '-',
      status: 'CONFIGING',
      cfgStatus: '1',
    }

    setCards([...cards, newCard].sort((a, b) => a.slot - b.slot))
    setShowAddModal(false)
    setNewSlotNumber(1)
    setNewCardType('GTGO')
  }

  const handleDeleteCards = () => {
    setCards(cards.filter(card => !selectedCards.includes(card.id)))
    setSelectedCards([])
    setShowDeleteConfirm(false)
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">OLT Card Management</h2>
          <p className="text-sm text-gray-600 mt-1">Manage OLT line cards and service cards</p>
        </div>

        {/* Action Buttons */}
        {userRole === 'admin' && (
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              disabled={!isMatch}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={18} />
              <span>Add Card</span>
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={selectedCards.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium transition-colors border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={18} />
              <span>Delete Card</span>
            </button>
          </div>
        )}
      </div>

      {/* OLT Type Selector */}
      <div className="relative z-30">
        <OLTSelector selectedOLT={selectedOLT} onOLTChange={onOLTChange} variant="compact" />
      </div>

      {/* OLT Cards Table */}
      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-red-50 to-white border-b border-red-100">
                {userRole === 'admin' && (
                  <th className="px-4 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedCards.length === cards.length && cards.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                  </th>
                )}
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Rack</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Shelf</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Slot</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Configured Type</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Card Name</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Port</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Hardware Version</th>
                {(selectedOLT.toLowerCase() === 'c300' || selectedOLT.toLowerCase() === 'c320') && (
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Software Version</th>
                )}
                <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading || connectionState === 'LOADING' ? (
                <tr>
                  <td colSpan={userRole === 'admin' ? 9 : 8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
                      <p className="text-sm text-gray-500 font-medium animate-pulse">
                        {connectionState === 'LOADING' 
                          ? "Establishing hardware handshake with OLT..." 
                          : "Retrieving live card inventory via SNMP..."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : cards.map((card) => (
                <tr
                  key={card.id}
                  className={`hover:bg-red-50/50 transition-colors ${selectedCards.includes(card.id) ? 'bg-red-50' : ''}`}
                >
                  {userRole === 'admin' && (
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedCards.includes(card.id)}
                        onChange={(e) => handleSelectCard(card.id, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-4 text-sm text-gray-900 font-medium">{card.rack}</td>
                  <td className="px-4 py-4 text-sm text-gray-900 font-medium">{card.shelf}</td>
                  <td className="px-4 py-4 text-sm text-gray-900 font-medium">{card.slot}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{card.configuredType}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{card.cardName}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{card.port}</td>
                  <td className="px-4 py-4 text-sm text-gray-700">{card.hardwareVersion}</td>
                  {(selectedOLT.toLowerCase() === 'c300' || selectedOLT.toLowerCase() === 'c320') && (
                    <td className="px-4 py-4 text-sm text-gray-700">{card.softwareVersion}</td>
                  )}
                  <td className="px-4 py-4">
                    <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full border ${getStatusStyle(card.status)}`}>
                      {card.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && connectionState !== 'LOADING' && cards.length === 0 && (
          <div className="text-center py-16 flex flex-col items-center justify-center gap-3">
            {connectionState === 'NO_PROFILE' ? (
              <>
                <AlertTriangle className="w-8 h-8 text-amber-500 animate-pulse" />
                <p className="text-sm text-gray-500 font-medium">
                  No OLT profile configured for this type. Please configure profile.
                </p>
              </>
            ) : connectionState === 'MISMATCH' ? (
              <>
                <AlertTriangle className="w-8 h-8 text-red-500 animate-bounce" />
                <p className="text-sm text-red-600 font-semibold">
                  OLT Type mismatch! Selected type does not match physical hardware.
                </p>
              </>
            ) : connectionState === 'NO_CONNECTION' ? (
              <>
                <AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" />
                <p className="text-sm text-gray-500 font-medium">
                  Cannot connect to OLT. Please verify physical network path.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 font-medium">
                {!isMatch ? "Please connect to OLT to view hardware cards" : "No OLT cards detected"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Add Card Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-red-100 w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-white rounded-t-xl">
              <h3 className="text-lg font-semibold text-gray-900">Add New Card</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Slot Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Slot Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newSlotNumber}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '')
                    setNewSlotNumber(val === '' ? 1 : parseInt(val))
                  }}
                  placeholder="Enter slot number"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Enter slot number manually (numbers only)</p>
              </div>

              {/* Card Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Card Type</label>
                <input
                  type="text"
                  value={newCardType}
                  onChange={(e) => setNewCardType(e.target.value.toUpperCase())}
                  placeholder="e.g. GTGO, ETGH, SCXN"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Enter card type manually (e.g. GTGO, ETGH)</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCard}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
                >
                  Add Card
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-red-100 w-full max-w-md">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-white rounded-t-xl">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Confirm Delete</h3>
            </div>

            <div className="p-6">
              <p className="text-gray-700 mb-4">
                Are you sure you want to delete the following {selectedCards.length} card(s)?
              </p>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 max-h-40 overflow-y-auto">
                <ul className="space-y-1">
                  {selectedCards.map(cardId => {
                    const card = cards.find(c => c.id === cardId)
                    return card ? (
                      <li key={cardId} className="text-sm text-red-700">
                        Slot {card.slot}: {card.configuredType} ({card.cardName})
                      </li>
                    ) : null
                  })}
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCards}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
                >
                  Delete Cards
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
