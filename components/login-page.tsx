'use client'

import Image from 'next/image'
import { Lock, User, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface LoginPageProps {
  onLoginSuccess: (user: any) => void
  onBackToGuest?: () => void
}

export default function LoginPage({ onLoginSuccess, onBackToGuest }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [lockoutTime, setLockoutTime] = useState(0)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (lockoutTime > 0) {
      timer = setInterval(() => {
        setLockoutTime((prev) => prev - 1)
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [lockoutTime])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include'
      })

      if (res.ok) {
        const data = await res.json()
        setIsSuccess(true)
        // Delay slightly for success animation
        setTimeout(() => {
          onLoginSuccess(data.user)
        }, 800)
      } else {
        const data = await res.json()
        const detail = data.detail || 'Invalid username or password'
        if (typeof detail === 'string' && detail.startsWith('Wait:')) {
          const waitTime = parseInt(detail.split(':')[1])
          setLockoutTime(waitTime)
          setError('')
        } else {
          setError(detail)
        }
      }
    } catch (err) {
      setError('Cannot connect to backend service')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <AnimatePresence>
        <motion.div 
          className="w-full max-w-md relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ 
            opacity: 1, 
            y: 0,
            x: error ? [0, -10, 10, -10, 10, 0] : 0,
            scale: isSuccess ? 1.05 : 1
          }}
          transition={{ 
            type: "spring", 
            stiffness: 300, 
            damping: 30,
            x: { duration: 0.4 }
          }}
        >
          {/* Decorative Background Glows */}
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-red-500/20 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>

          <div className="relative bg-white/40 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.37)] p-8 border border-white/40 overflow-hidden group">
            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none"></div>

            {/* Logo and Title */}
            <div className="flex flex-col items-center mb-10 relative z-10">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <Image
                  src="/falcom-logo.png"
                  alt="FALCOM Technology Logo"
                  width={160}
                  height={60}
                  className="h-auto mb-6 drop-shadow-sm"
                  style={{ width: 'auto', height: 'auto' }}
                />
              </motion.div>
              <h1 className="text-2xl font-black text-gray-800 tracking-tight uppercase">
                OLT <span className="text-red-600">Management</span>
              </h1>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mt-1 opacity-60">Network Management System</p>
            </div>

            {/* Error Message */}
            <AnimatePresence mode="wait">
              {(error || lockoutTime > 0) && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3"
                >
                  <AlertCircle size={18} className="text-red-600 shrink-0" />
                  <p className="text-sm font-medium text-red-800">
                    {lockoutTime > 0 
                      ? `Too many attempts. Try again in ${Math.floor(lockoutTime / 60)}m ${lockoutTime % 60}s`
                      : error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success Message */}
            <AnimatePresence>
              {isSuccess && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 z-20 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center rounded-3xl"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 12 }}
                  >
                    <CheckCircle2 size={64} className="text-emerald-500 mb-4" />
                  </motion.div>
                  <h2 className="text-xl font-bold text-gray-900">Access Granted</h2>
                  <p className="text-gray-500 text-sm mt-1">Initializing workspace...</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-5 relative z-10">
              {/* Username Field */}
              <div className="group/field">
                <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-2 ml-1">Username</label>
                <div className="flex items-center bg-white/50 border border-gray-200/50 rounded-2xl overflow-hidden transition-all duration-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-red-500/10 focus-within:border-red-500/30">
                  <div className="pl-4 py-4 text-gray-400 group-focus-within/field:text-red-600 transition-colors">
                    <User size={20} strokeWidth={2.5} />
                  </div>
                  <input
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="flex-1 bg-transparent px-4 py-4 focus:outline-none text-gray-800 font-medium placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="group/field">
                <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-2 ml-1">Password</label>
                <div className="flex items-center bg-white/50 border border-gray-200/50 rounded-2xl overflow-hidden transition-all duration-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-red-500/10 focus-within:border-red-500/30">
                  <div className="pl-4 py-4 text-gray-400 group-focus-within/field:text-red-600 transition-colors">
                    <Lock size={20} strokeWidth={2.5} />
                  </div>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 bg-transparent px-4 py-4 focus:outline-none text-gray-800 font-medium placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Login Button */}
              <motion.button
                type="submit"
                disabled={loading || isSuccess || lockoutTime > 0}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="w-full mt-8 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-black py-4 rounded-2xl transition-all duration-300 shadow-[0_10px_20px_-10px_rgba(220,38,38,0.5)] flex items-center justify-center gap-2 overflow-hidden relative"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <span className="uppercase tracking-widest text-sm">Sign In</span>
                )}
              </motion.button>

              {/* Back to Guest Mode */}
              {onBackToGuest && (
                <motion.button
                  type="button"
                  onClick={onBackToGuest}
                  whileHover={{ x: -2 }}
                  className="w-full mt-4 text-[11px] font-bold text-gray-500 hover:text-red-600 transition-colors uppercase tracking-widest flex items-center justify-center gap-1"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                  </svg>
                  Continue as Guest
                </motion.button>
              )}
            </form>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
