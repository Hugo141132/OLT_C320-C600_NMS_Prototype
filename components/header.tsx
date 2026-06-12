'use client'

import Image from 'next/image'
import { Menu, LogOut, User, Settings } from 'lucide-react'
import { motion } from 'framer-motion'

type UserRole = 'admin' | 'guest'

interface HeaderProps {
  onToggleSidebar: () => void
  userRole: UserRole
  isLoggedIn: boolean
  onLogout: () => void
  onLoginClick: () => void
  onProfileClick?: () => void
}

export default function Header({ onToggleSidebar, userRole, isLoggedIn, onLogout, onLoginClick, onProfileClick }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-white/60 backdrop-blur-xl border-b border-white/20 shadow-[0_4px_30px_rgba(0,0,0,0.05)] overflow-hidden">
      {/* Decorative top line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent"></div>
      
      <div className="flex items-center justify-between px-4 md:px-8 h-full relative z-10">
        {/* Left: Menu toggle and branding */}
        <div className="flex items-center gap-3 md:gap-6">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onToggleSidebar}
            className="md:hidden p-2.5 hover:bg-red-500/10 rounded-xl transition-colors group"
            aria-label="Toggle sidebar"
          >
            <Menu size={22} className="text-gray-700 group-hover:text-red-600" />
          </motion.button>

          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Image
              src="/falcom-logo.png"
              alt="FALCOM Technology Logo"
              width={140}
              height={50}
              className="h-auto w-24 md:w-36 drop-shadow-sm"
              style={{ height: 'auto' }}
            />
          </motion.div>
        </div>

        {/* Right: User actions */}
        <div className="flex items-center gap-2 md:gap-3">
          {isLoggedIn && (
            <div className="flex items-center gap-1 md:gap-2">
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onProfileClick}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-gray-100/50 hover:bg-red-500/10 border border-gray-200/50 transition-all group"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-white shadow-sm">
                  <User size={14} strokeWidth={3} />
                </div>
                <span className="hidden md:block text-xs font-bold text-gray-700 uppercase tracking-tight group-hover:text-red-700 transition-colors">
                  {userRole}
                </span>
              </motion.button>

              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onLogout}
                className="ml-1 p-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                title="Logout"
              >
                <LogOut size={20} />
              </motion.button>
            </div>
          )}

          {!isLoggedIn && userRole === 'guest' && (
            <motion.button 
              whileHover={{ scale: 1.02, boxShadow: '0 10px 15px -3px rgba(220, 38, 38, 0.3)' }}
              whileTap={{ scale: 0.98 }}
              onClick={onLoginClick}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <User size={14} strokeWidth={3} />
              Login
            </motion.button>
          )}
        </div>
      </div>
    </header>
  )
}
