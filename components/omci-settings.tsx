'use client'

import { Settings, AlertCircle } from 'lucide-react'

export default function OMCISettings() {
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Page Title */}
      <div className="flex items-center gap-3">
        <Settings size={32} className="text-red-600" />
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">OMCI Settings</h2>
      </div>

      {/* Settings Container */}
      <div className="bg-white/95 backdrop-blur-md rounded-lg shadow-md border border-red-100 p-6 space-y-6">
        {/* Section 1: Global OMCI Configuration */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Global OMCI Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">OMCI Timeout (seconds)</label>
              <input
                type="number"
                defaultValue="10"
                className="w-full px-4 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Retries</label>
              <input
                type="number"
                defaultValue="3"
                className="w-full px-4 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="auto-discovery"
                defaultChecked
                className="w-4 h-4 rounded border-red-300 accent-red-600"
              />
              <label htmlFor="auto-discovery" className="text-sm text-gray-700">
                Enable Auto Discovery
              </label>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-red-100" />

        {/* Section 2: ONU Management */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">ONU Management</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default ONU Behavior</label>
              <select className="w-full px-4 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white">
                <option>Automatic Configuration</option>
                <option>Manual Configuration</option>
                <option>Hybrid Mode</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="port-protection"
                defaultChecked
                className="w-4 h-4 rounded border-red-300 accent-red-600"
              />
              <label htmlFor="port-protection" className="text-sm text-gray-700">
                Enable Port Protection
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="vlan-tagging"
                defaultChecked
                className="w-4 h-4 rounded border-red-300 accent-red-600"
              />
              <label htmlFor="vlan-tagging" className="text-sm text-gray-700">
                Enable VLAN Tagging
              </label>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-red-100" />

        {/* Section 3: Advanced Settings */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Advanced Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Optical Power Threshold (dBm)</label>
              <input
                type="number"
                step="0.1"
                defaultValue="-28"
                className="w-full px-4 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">Alert when optical power drops below this value</p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="alert-low-power"
                defaultChecked
                className="w-4 h-4 rounded border-red-300 accent-red-600"
              />
              <label htmlFor="alert-low-power" className="text-sm text-gray-700">
                Alert on Low Optical Power
              </label>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-red-100" />

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <button className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
            Save Changes
          </button>
          <button className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors">
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Info Alert */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
        <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">Settings Information</p>
          <p className="text-sm text-blue-800 mt-1">
            These settings apply globally to all ONU devices managed through this system. Changes will take effect immediately.
          </p>
        </div>
      </div>
    </div>
  )
}
