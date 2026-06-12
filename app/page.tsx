'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/sidebar'
import Header from '@/components/header'
import Dashboard from '@/components/dashboard'
import OLTCards from '@/components/olt-cards'
import ONUList from '@/components/onu-list'
import dynamic from 'next/dynamic'
import OMCIConfig from '@/components/omci-config'
import { motion, AnimatePresence } from 'framer-motion'


import LoginPage from '@/components/login-page'
import ProfilePage from '@/components/profile-page'
import Console, { ConnectionWizardModal } from '@/components/console'
import Provisioning from '@/components/provisioning'
import { useSerialConnection } from '@/hooks/use-serial-connection'
import { ONU } from '@/lib/types'

type UserRole = 'admin' | 'guest'


export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [userRole, setUserRole] = useState<UserRole>('guest')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [globalSelectedOLT, setGlobalSelectedOLT] = useState<string>('c600') // Global OLT state persisted across pages
  const [selectedONU, setSelectedONU] = useState<ONU | null>(null)
  const [showConnectionWizard, setShowConnectionWizard] = useState(false)
  const [completedOMCIOnuIds, setCompletedOMCIOnuIds] = useState<Set<string>>(new Set())

  // Hardware agent hook — provides real serial connection state
  const serial = useSerialConnection()

  const [isClient, setIsClient] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(true)

  // 1. Load session on mount
  useEffect(() => {
    const checkSession = async () => {
      setIsClient(true)
      setIsLoadingSession(true)
      try {
        const isTabAuth = sessionStorage.getItem('oltTabAuth') === 'true'
        if (!isTabAuth) {
          setIsLoggedIn(false)
          setIsLoadingSession(false)
          return
        }

        
        const res = await fetch(`/api/auth/me`, {
          credentials: 'include'
        })
        if (res.ok) {
          const user = await res.json()
          if (user.role === 'admin' || user.role === 'guest') {
            setIsLoggedIn(true)
            setUserRole(user.role)
          } else {
            setIsLoggedIn(false)
            setUserRole('guest')
          }
        } else {
          setIsLoggedIn(false)
          setUserRole('guest')
        }
        
        // Restore non-auth state from session storage
        const sessionStr = sessionStorage.getItem('oltWebSession')
        if (sessionStr) {
          const session = JSON.parse(sessionStr)
          if (session.currentPage) setCurrentPage(session.currentPage)
          if (session.globalSelectedOLT) setGlobalSelectedOLT(session.globalSelectedOLT)
        }
      } catch (e) {
        console.error('Failed to verify session:', e)
      } finally {
        setIsLoadingSession(false)
      }
    }
    
    checkSession()
  }, [])

  // 2. Auto-save session when navigated or logged in
  useEffect(() => {
    if (!isClient) return
    if (isLoggedIn) {
      const existingStr = sessionStorage.getItem('oltWebSession')
      let loginTime = Date.now()
      if (existingStr) {
        try {
          const session = JSON.parse(existingStr)
          if (session.loginTime) loginTime = session.loginTime
        } catch (e) {}
      }
      const sessionData = {
        isLoggedIn,
        userRole,
        currentPage,
        globalSelectedOLT,
        loginTime
      }
      sessionStorage.setItem('oltWebSession', JSON.stringify(sessionData))
    }
  }, [isLoggedIn, userRole, currentPage, globalSelectedOLT, isClient])

  const handleLoginSuccess = (user: any) => {
    sessionStorage.setItem('oltTabAuth', 'true')
    setIsLoggedIn(true)
    setUserRole(user.role || 'guest')
    setCurrentPage('dashboard')
  }

  const handleLogout = async () => {
    sessionStorage.removeItem('oltTabAuth')
    try {
      
      await fetch(`/api/auth/logout`, { 
        method: 'POST',
        credentials: 'include'
      })
    } catch (e) {}
    
    setUserRole('guest')
    setIsLoggedIn(false)
    setCurrentPage('dashboard')
    sessionStorage.removeItem('oltWebSession')
    
    // Return to user exec mode (hostname>) on logout
    serial.sendInput('\x03') // SIGINT
    serial.sendInput('\r')
    setTimeout(() => serial.sendInput('end\r'), 100)
    setTimeout(() => serial.sendInput('disable\r'), 200)
    setTimeout(() => {
      serial.closeTerminalWs()
      serial.disconnect()
    }, 400)
  }

  const handleLoginClick = () => {
    setIsLoggedIn(false)
  }

  const handleNavigateToONUList = (status: string) => {
    setFilterStatus(status)
    setCurrentPage('onu-list')
  }

  const handleOMCIConfig = (onu: ONU) => {
    setSelectedONU(onu)
    setCurrentPage('omci-config')
  }


  const handleConsoleClick = () => {
    setShowConnectionWizard(true)
  }

  const handleConnectionSuccess = () => {
    setShowConnectionWizard(false)
    setCurrentPage('console-inspect')
  }

  // Show loading state while checking session on first render
  if (isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundImage: 'url(/nms-bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
        <div className="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-700 font-medium">Loading workspace...</p>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (currentPage) {
      case 'dashboard':
      case 'onu-list':
        return null;
      case 'olt-cards':
        return <OLTCards userRole={userRole} selectedOLT={globalSelectedOLT} onOLTChange={setGlobalSelectedOLT} />
      case 'omci-config':
        return selectedONU && userRole === 'admin' ? (
          <OMCIConfig 
            onu={selectedONU} 
            onBack={() => setCurrentPage('onu-list')} 
            onComplete={(onuId: string) => {
              setCompletedOMCIOnuIds(prev => new Set([...prev, onuId]))
              setCurrentPage('onu-list')
            }} 
          />
        ) : null
      case 'profile':
        return <ProfilePage userRole={userRole} selectedOLT={globalSelectedOLT} />
      case 'console-inspect':
        return <Console page="inspect" serial={serial} />
      case 'console-outband':
        return <Console page="outband" serial={serial} />
      case 'console-inband':
        return <Console page="inband" serial={serial} />
      case 'console-terminal':
        return <Console page="terminal" serial={serial} />
      case 'console-telnet':
        return <Console page="telnet" serial={serial} />
      case 'console-ssh':
        return <Console page="ssh" serial={serial} />
      case 'provisioning-vlan':
        return <Provisioning page="vlan" selectedOLT={globalSelectedOLT} onOLTChange={setGlobalSelectedOLT} />
      case 'provisioning-onu-profile':
        return <Provisioning page="onu-profile" selectedOLT={globalSelectedOLT} onOLTChange={setGlobalSelectedOLT} />
      case 'provisioning-tcont-profile':
        return <Provisioning page="tcont-profile" selectedOLT={globalSelectedOLT} onOLTChange={setGlobalSelectedOLT} />
      default:
        return <Dashboard userRole={userRole} onNavigateToONUList={handleNavigateToONUList} selectedOLT={globalSelectedOLT} onOLTChange={setGlobalSelectedOLT} />
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundImage: 'url(/nms-bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
      <AnimatePresence mode="wait">
        {!isLoggedIn ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          >
            <LoginPage onLoginSuccess={handleLoginSuccess} />
          </motion.div>
        ) : (
          <motion.div
            key="main-app"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="flex flex-col flex-1"
          >
            {/* Header */}
            <Header 
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} 
              userRole={userRole}
              isLoggedIn={isLoggedIn}
              onLogout={handleLogout}
              onLoginClick={handleLoginClick}
              onProfileClick={() => setCurrentPage('profile')}
            />

            {/* Main Content with padding for fixed header */}
            <div className="flex flex-1 overflow-hidden pt-16">
              {/* Sidebar - show for both guest and admin */}
              <Sidebar 
          isOpen={sidebarOpen} 
          onClose={() => setSidebarOpen(false)} 
          onNavigate={setCurrentPage} 
          currentPage={currentPage} 
          userRole={userRole}
          onConsoleClick={handleConsoleClick}
          isConsoleConnected={serial.status.is_connected}
          backendOnline={serial.backendOnline}
        />

        {/* Main Dashboard Area */}
        <main className={`flex-1 overflow-auto transition-all duration-300 md:ml-64 relative`}>
          {/* Active Page View */}
          {currentPage === 'dashboard' && (
            <Dashboard 
              userRole={userRole} 
              onNavigateToONUList={handleNavigateToONUList} 
              selectedOLT={globalSelectedOLT} 
              onOLTChange={setGlobalSelectedOLT} 
            />
          )}
          
          {currentPage === 'onu-list' && (
            <ONUList 
              userRole={userRole} 
              filterStatus={filterStatus} 
              selectedOLT={globalSelectedOLT} 
              onOLTChange={setGlobalSelectedOLT} 
              onOMCIConfig={handleOMCIConfig} 
              completedOMCIOnuIds={completedOMCIOnuIds} 
            />
          )}

          {/* Dynamic Pages */}
          {renderContent()}
        </main>
      </div>

      {/* Connection Wizard Modal */}
      <ConnectionWizardModal
        isOpen={showConnectionWizard}
        onClose={() => setShowConnectionWizard(false)}
        onSuccess={handleConnectionSuccess}
        selectedOLT={globalSelectedOLT}
        onOLTChange={setGlobalSelectedOLT}
        serial={serial}
      />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
