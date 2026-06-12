'use client'

import { useState } from 'react'
import { LayoutDashboard, Network, Map, X, HardDrive, Terminal, ChevronDown, ChevronRight, Search, Globe, Wifi, SquareTerminal, Server, Shield, Layers, Radio, User, Settings } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: string) => void
  currentPage: string
  userRole: 'admin' | 'guest'
  onConsoleClick?: () => void
  isConsoleConnected?: boolean
  backendOnline?: boolean
}

export default function Sidebar({ isOpen, onClose, onNavigate, currentPage, userRole, onConsoleClick, isConsoleConnected, backendOnline }: SidebarProps) {
  const [isConsoleExpanded, setIsConsoleExpanded] = useState(false)
  const [isProvisioningExpanded, setIsProvisioningExpanded] = useState(false)

  const navItems = [
    { icon: LayoutDashboard, label: 'OLT Info', id: 'dashboard', requiresAdmin: false },
    { icon: HardDrive, label: 'OLT Cards', id: 'olt-cards', requiresAdmin: true },
    { icon: Network, label: 'ONU List', id: 'onu-list', requiresAdmin: false },
  ]

  const consoleSubItems = [
    { icon: Search, label: 'Inspect', id: 'console-inspect' },
    { icon: Globe, label: 'Out-Band IP', id: 'console-outband' },
    { icon: Wifi, label: 'In-Band IP', id: 'console-inband' },
    { icon: SquareTerminal, label: 'Terminal', id: 'console-terminal' },
  ]

  const provisioningSubItems = [
    { icon: Network, label: 'Create VLAN', id: 'provisioning-vlan' },
    { icon: User, label: 'ONU Profile VLAN', id: 'provisioning-onu-profile' },
    { icon: Radio, label: 'TCONT Profile', id: 'provisioning-tcont-profile' },
  ]

  // Filter items based on user role
  const visibleItems = navItems.filter(item => {
    if (item.requiresAdmin && userRole === 'guest') {
      return false
    }
    return true
  })

  const handleConsoleClick = () => {
    if (!isConsoleConnected) {
      onConsoleClick?.()
    } else {
      setIsConsoleExpanded(!isConsoleExpanded)
    }
  }

  const handleConsoleSubItemClick = (id: string) => {
    if (!isConsoleConnected) {
      onConsoleClick?.()
    } else {
      onNavigate(id)
      onClose()
    }
  }

  const isConsolePage = currentPage.startsWith('console-')
  const isProvisioningPage = currentPage.startsWith('provisioning-')

  const handleProvisioningSubItemClick = (id: string) => {
    onNavigate(id)
    onClose()
  }

  const renderConsoleBadge = () => {
    if (isConsoleConnected) {
      return (
        <span className="px-1.5 py-0.5 bg-emerald-100/80 text-emerald-700 text-xs rounded flex items-center gap-1 backdrop-blur-sm shadow-sm border border-emerald-200/50">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Connected
        </span>
      )
    }
    if (backendOnline) {
      return (
        <span className="px-1.5 py-0.5 bg-yellow-100/80 text-yellow-700 text-xs rounded flex items-center gap-1 backdrop-blur-sm shadow-sm border border-yellow-200/50">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
          Ready
        </span>
      )
    }
    return (
      <span className="px-1.5 py-0.5 bg-gray-100/80 text-gray-500 text-xs rounded flex items-center gap-1 backdrop-blur-sm shadow-sm border border-gray-200/50">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
        Offline
      </span>
    )
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 md:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed top-16 left-0 h-[calc(100vh-64px)] w-64 bg-white/70 backdrop-blur-xl border-r border-red-100/50 shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-40 overflow-y-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <button
          onClick={onClose}
          className="md:hidden absolute top-4 right-4 p-2 hover:bg-red-50/80 rounded-lg transition-colors"
          aria-label="Close sidebar"
        >
          <X size={20} className="text-gray-500" />
        </button>

        <nav className="p-4 pt-8 md:pt-4 space-y-1.5">
          {/* Dashboard item */}
          <motion.button
            whileHover={{ scale: 1.01, x: 2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              onNavigate('dashboard')
              onClose()
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors group ${
              currentPage === 'dashboard'
                ? 'bg-red-50/80 text-red-600 shadow-sm border border-red-100/50'
                : 'text-gray-600 hover:bg-red-50/50 hover:text-red-600 border border-transparent'
            }`}
          >
            <LayoutDashboard size={18} className={`transition-colors ${currentPage === 'dashboard' ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
            <span className="font-medium text-sm">OLT Info</span>
          </motion.button>

          {userRole === 'admin' && (
            <div>
              <motion.button
                whileHover={{ scale: 1.01, x: 2 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleConsoleClick}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors group ${
                  isConsolePage
                    ? 'bg-red-50/80 text-red-600 shadow-sm border border-red-100/50'
                    : 'text-gray-600 hover:bg-red-50/50 hover:text-red-600 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Terminal size={18} className={`transition-colors ${isConsolePage ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
                  <span className="font-medium text-sm">Console</span>
                  {renderConsoleBadge()}
                </div>
                {isConsoleConnected && (
                  <motion.div animate={{ rotate: (isConsoleExpanded || isConsolePage) ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown size={14} className="text-gray-400" />
                  </motion.div>
                )}
              </motion.button>

              <AnimatePresence>
                {isConsoleConnected && (isConsoleExpanded || isConsolePage) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="ml-5 mt-1 space-y-1 border-l border-red-100/50 pl-3">
                      {consoleSubItems.map((item) => (
                        <motion.button
                          whileHover={{ scale: 1.01, x: 2 }}
                          whileTap={{ scale: 0.98 }}
                          key={item.id}
                          onClick={() => handleConsoleSubItemClick(item.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
                            currentPage === item.id
                              ? 'bg-red-50/80 text-red-600'
                              : 'text-gray-500 hover:bg-red-50/50 hover:text-red-600'
                          }`}
                        >
                          <item.icon size={16} className={`transition-colors ${currentPage === item.id ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
                          <span className="text-sm">{item.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {visibleItems.filter(item => item.id !== 'dashboard').map((item) => (
            <div key={item.label}>
              <motion.button
                whileHover={{ scale: 1.01, x: 2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  onNavigate(item.id)
                  onClose()
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors group ${
                  currentPage === item.id
                    ? 'bg-red-50/80 text-red-600 shadow-sm border border-red-100/50'
                    : 'text-gray-600 hover:bg-red-50/50 hover:text-red-600 border border-transparent'
                }`}
              >
                <item.icon size={18} className={`transition-colors ${currentPage === item.id ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
                <span className="font-medium text-sm">{item.label}</span>
              </motion.button>

              {item.id === 'olt-cards' && userRole === 'admin' && (
                <div className="mt-1.5">
                  <motion.button
                    whileHover={{ scale: 1.01, x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setIsProvisioningExpanded(!isProvisioningExpanded)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors group ${
                      isProvisioningPage
                        ? 'bg-red-50/80 text-red-600 shadow-sm border border-red-100/50'
                        : 'text-gray-600 hover:bg-red-50/50 hover:text-red-600 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Layers size={18} className={`transition-colors ${isProvisioningPage ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
                      <span className="font-medium text-sm">Provisioning</span>
                    </div>
                    <motion.div animate={{ rotate: (isProvisioningExpanded || isProvisioningPage) ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown size={14} className="text-gray-400" />
                    </motion.div>
                  </motion.button>

                  <AnimatePresence>
                    {(isProvisioningExpanded || isProvisioningPage) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="ml-5 mt-1 space-y-1 border-l border-red-100/50 pl-3">
                          {provisioningSubItems.map((subItem) => (
                            <motion.button
                              whileHover={{ scale: 1.01, x: 2 }}
                              whileTap={{ scale: 0.98 }}
                              key={subItem.id}
                              onClick={() => handleProvisioningSubItemClick(subItem.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
                                currentPage === subItem.id
                                  ? 'bg-red-50/80 text-red-600'
                                  : 'text-gray-500 hover:bg-red-50/50 hover:text-red-600'
                              }`}
                            >
                              <subItem.icon size={16} className={`transition-colors ${currentPage === subItem.id ? 'text-red-600' : 'text-gray-400 group-hover:text-red-600'}`} />
                              <span className="text-sm">{subItem.label}</span>
                            </motion.button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
