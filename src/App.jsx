import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Search,
  CheckCircle,
  AlertCircle,
  X as XIcon
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Use environment variable with fallback
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://x-backend-production-c71b.up.railway.app';

// Generate mock price data
const generateMockData = (basePrice) => {
  return Array.from({ length: 50 }, (_, i) => ({
    time: i,
    price: basePrice + (Math.random() - 0.5) * basePrice * 0.05
  }));
};

function App() {
  // Wallet states
  const [userWallet, setUserWallet] = useState(null);
  const [agentWallet, setAgentWallet] = useState(null);
  const [isAgentActivated, setIsAgentActivated] = useState(false);
  
  // Market data
  const [assets, setAssets] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  
  // Trading states
  const [usdSize, setUsdSize] = useState('100');
  const [leverage, setLeverage] = useState(1);
  const [isTrading, setIsTrading] = useState(false);
  const [notification, setNotification] = useState(null);
  
  // Chart data
  const [chartData, setChartData] = useState([]);

  // Initialize agent wallet on load
  useEffect(() => {
    const storedKey = localStorage.getItem('local_agent_key');
    
    if (storedKey) {
      try {
        const wallet = new ethers.Wallet(storedKey);
        setAgentWallet(wallet);
        setIsAgentActivated(true);
      } catch (e) {
        console.error('Invalid stored key, generating new one');
        generateNewAgentWallet();
      }
    } else {
      generateNewAgentWallet();
    }
  }, []);

  // Fetch markets on load
  useEffect(() => {
    fetchMarkets();
  }, []);

  // Update chart when asset selected
  useEffect(() => {
    if (selectedAsset) {
      setChartData(generateMockData(selectedAsset.price));
    }
  }, [selectedAsset]);

  const generateNewAgentWallet = () => {
    const wallet = ethers.Wallet.createRandom();
    localStorage.setItem('local_agent_key', wallet.privateKey);
    setAgentWallet(wallet);
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        showNotification('MetaMask not found. Please install MetaMask.', 'error');
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      
      setUserWallet({
        address: accounts[0],
        signer
      });
      
      showNotification('Wallet connected successfully!', 'success');
    } catch (error) {
      console.error('Error connecting wallet:', error);
      showNotification('Failed to connect wallet', 'error');
    }
  };

  const activateAgent = async () => {
    if (!userWallet) {
      showNotification('Please connect your wallet first', 'error');
      return;
    }

    try {
      const message = `Authorize Agent Wallet: ${agentWallet.address}\n\nThis allows X/CHANGE to execute trades on your behalf using a secure agent key.`;
      
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet.address]
      });

      console.log('Agent authorized with signature:', signature);
      setIsAgentActivated(true);
      showNotification('Agent activated successfully!', 'success');
    } catch (error) {
      console.error('Error activating agent:', error);
      showNotification('Failed to activate agent', 'error');
    }
  };

  const fetchMarkets = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/markets`);
      setAssets(response.data);
      if (response.data.length > 0) {
        setSelectedAsset(response.data[0]);
      }
    } catch (error) {
      console.error('Error fetching markets:', error);
      showNotification('Failed to fetch market data', 'error');
    }
  };

  const executeTrade = async (isBuy) => {
    if (!isAgentActivated) {
      showNotification('Please activate your agent first', 'error');
      return;
    }

    if (!selectedAsset) {
      showNotification('Please select an asset', 'error');
      return;
    }

    if (!usdSize || parseFloat(usdSize) <= 0) {
      showNotification('Please enter a valid USD amount', 'error');
      return;
    }

    setIsTrading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/trade`, {
        user_agent_private_key: agentWallet.privateKey,
        coin: selectedAsset.symbol,
        is_buy: isBuy,
        usd_size: parseFloat(usdSize),
        leverage: leverage
      });

      showNotification(
        `${isBuy ? 'LONG' : 'SHORT'} executed: ${selectedAsset.symbol} at ${leverage}x`,
        'success'
      );
      
      console.log('Trade result:', response.data);
    } catch (error) {
      console.error('Trade error:', error);
      const errorMsg = error.response?.data?.detail || 'Trade execution failed';
      showNotification(errorMsg, 'error');
    } finally {
      setIsTrading(false);
    }
  };

  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const filteredAssets = assets.filter(asset => 
    searchFilter === '' || 
    asset.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (searchFilter.toLowerCase() === 'hip' && asset.symbol.startsWith('HIP'))
  );

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/95 backdrop-blur sticky top-0 z-50">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl font-black tracking-tighter">
              <span className="text-white">X/</span>
              <span className="text-gray-400">CHANGE</span>
            </div>
            <div className="text-xs text-gray-600 mt-2">PERPETUAL EXCHANGE</div>
          </div>
          
          <div className="flex items-center gap-4">
            {agentWallet && (
              <div className="text-xs text-gray-500 hidden md:block">
                AGENT: {agentWallet.address.slice(0, 6)}...{agentWallet.address.slice(-4)}
              </div>
            )}
            
            {userWallet ? (
              <div className="flex items-center gap-3">
                {!isAgentActivated && (
                  <button
                    onClick={activateAgent}
                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm transition-colors"
                  >
                    ACTIVATE AGENT
                  </button>
                )}
                <div className="px-4 py-2 bg-gray-900 border border-gray-700 text-sm flex items-center gap-2">
                  <Wallet size={16} />
                  {userWallet.address.slice(0, 6)}...{userWallet.address.slice(-4)}
                </div>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                className="px-6 py-3 bg-white hover:bg-gray-200 text-black font-bold text-sm transition-colors flex items-center gap-2"
              >
                <Wallet size={18} />
                CONNECT WALLET
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div className="fixed top-20 right-6 z-50 animate-slide-in">
          <div className={`px-6 py-4 border ${
            notification.type === 'success' 
              ? 'bg-green-500/10 border-green-500 text-green-400' 
              : 'bg-red-500/10 border-red-500 text-red-400'
          } flex items-center gap-3`}>
            {notification.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span className="font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Sidebar - Assets */}
        <div className="w-80 border-r border-gray-800 flex flex-col bg-black">
          <div className="p-4 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
              <input
                type="text"
                placeholder="Search assets... (try 'HIP')"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-gray-600"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {filteredAssets.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => setSelectedAsset(asset)}
                className={`w-full px-4 py-3 text-left border-b border-gray-900 transition-colors ${
                  selectedAsset?.symbol === asset.symbol
                    ? 'bg-gray-900 border-l-2 border-l-white'
                    : 'hover:bg-gray-900/50'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-sm">{asset.symbol}</div>
                    <div className="text-xs text-gray-600">Max {asset.max_leverage}x</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm">${asset.price.toFixed(2)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Center - Chart */}
        <div className="flex-1 flex flex-col bg-black">
          <div className="p-6 border-b border-gray-800">
            {selectedAsset && (
              <div>
                <h2 className="text-3xl font-black tracking-tight">{selectedAsset.symbol}</h2>
                <div className="text-4xl font-black mt-2">${selectedAsset.price.toFixed(2)}</div>
                <div className="text-sm text-gray-600 mt-1">USD</div>
              </div>
            )}
          </div>
          
          <div className="flex-1 p-6">
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis 
                    dataKey="time" 
                    stroke="#333"
                    tick={{ fill: '#666', fontSize: 10 }}
                  />
                  <YAxis 
                    stroke="#333"
                    tick={{ fill: '#666', fontSize: 10 }}
                    domain={['dataMin - 10', 'dataMax + 10']}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#000', 
                      border: '1px solid #333',
                      borderRadius: 0
                    }}
                    labelStyle={{ color: '#999' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#fff" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right Panel - Trading */}
        <div className="w-96 border-l border-gray-800 flex flex-col bg-black">
          <div className="p-6 border-b border-gray-800">
            <h3 className="text-xl font-black tracking-tight">TRADE</h3>
          </div>
          
          <div className="flex-1 p-6 space-y-6">
            {/* Size Input */}
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-2">SIZE (USD)</label>
              <input
                type="number"
                value={usdSize}
                onChange={(e) => setUsdSize(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white px-4 py-3 text-lg font-bold focus:outline-none focus:border-gray-600"
                placeholder="100.00"
              />
            </div>

            {/* Leverage Slider */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold text-gray-500">LEVERAGE</label>
                <span className="text-2xl font-black">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={leverage}
                onChange={(e) => setLeverage(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-800 appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>1x</span>
                <span>5x</span>
                <span>10x</span>
              </div>
            </div>

            {/* Trade Buttons */}
            <div className="space-y-3">
              <button
                onClick={() => executeTrade(true)}
                disabled={isTrading || !isAgentActivated}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-black py-4 text-lg transition-colors flex items-center justify-center gap-2"
              >
                <TrendingUp size={20} />
                {isTrading ? 'EXECUTING...' : 'BUY / LONG'}
              </button>
              
              <button
                onClick={() => executeTrade(false)}
                disabled={isTrading || !isAgentActivated}
                className="w-full bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-black py-4 text-lg transition-colors flex items-center justify-center gap-2"
              >
                <TrendingDown size={20} />
                {isTrading ? 'EXECUTING...' : 'SELL / SHORT'}
              </button>
            </div>

            {/* Fee Notice */}
            <div className="border border-yellow-500/30 bg-yellow-500/5 p-4">
              <div className="text-xs font-bold text-yellow-500 mb-1">PLATFORM FEE</div>
              <div className="text-sm text-gray-400">3% of position size</div>
            </div>

            {/* Agent Status */}
            {agentWallet && (
              <div className={`border p-4 ${
                isAgentActivated 
                  ? 'border-green-500/30 bg-green-500/5' 
                  : 'border-gray-700 bg-gray-900'
              }`}>
                <div className="text-xs font-bold text-gray-500 mb-2">AGENT STATUS</div>
                <div className={`text-sm font-bold ${
                  isAgentActivated ? 'text-green-400' : 'text-gray-400'
                }`}>
                  {isAgentActivated ? '✓ ACTIVATED' : '✗ NOT ACTIVATED'}
                </div>
                <div className="text-xs text-gray-600 mt-1 break-all">
                  {agentWallet.address}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }

        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          background: white;
          cursor: pointer;
        }

        .slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: white;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}

export default App;