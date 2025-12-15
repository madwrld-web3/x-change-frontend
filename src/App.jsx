import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import {
    Wallet, TrendingUp, TrendingDown, Search, CheckCircle,
    AlertCircle, X as XIcon, RefreshCw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// --- CONFIGURATION ---
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://x-backend-production-c71b.up.railway.app';
const HYPERLIQUID_MAINNET_ID = 42161; // Arbitrum One Chain ID used for signing

function App() {
    const [userWallet, setUserWallet] = useState(null);
    const [agentWallet, setAgentWallet] = useState(null);
    const [isAgentActivated, setIsAgentActivated] = useState(false);

    const [assets, setAssets] = useState([]);
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');

    const [usdSize, setUsdSize] = useState('100');
    const [leverage, setLeverage] = useState(1);
    const [isTrading, setIsTrading] = useState(false);
    const [notification, setNotification] = useState(null);

    const [chartData, setChartData] = useState([]);
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState(null);
    const [isLoadingPositions, setIsLoadingPositions] = useState(false);

    // --- INITIALIZATION ---
    useEffect(() => {
        // 1. Generate or Load Agent Wallet (Ephemeral key for this browser)
        const storedKey = localStorage.getItem('local_agent_key');
        const storedActivation = localStorage.getItem('agent_activated');

        if (storedKey) {
            try {
                const wallet = new ethers.Wallet(storedKey);
                setAgentWallet(wallet);
                if (storedActivation === 'true') setIsAgentActivated(true);
            } catch (e) {
                generateNewAgentWallet();
            }
        } else {
            generateNewAgentWallet();
        }

        fetchMarkets();
    }, []);

    const generateNewAgentWallet = () => {
        const wallet = ethers.Wallet.createRandom();
        localStorage.setItem('local_agent_key', wallet.privateKey);
        setAgentWallet(wallet);
        setIsAgentActivated(false); // New wallet needs new approval
        localStorage.removeItem('agent_activated');
    };

    // --- MARKET DATA ---
    const fetchMarkets = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/markets`);
            setAssets(response.data);
            if (response.data.length > 0 && !selectedAsset) {
                setSelectedAsset(response.data[0]);
            }
        } catch (error) {
            console.error('Fetch markets error:', error);
        }
    };

    useEffect(() => {
        if (selectedAsset) {
            // Simple mock chart data based on real price
            const base = selectedAsset.price;
            const data = Array.from({ length: 20 }, (_, i) => ({
                time: i,
                price: base + (Math.random() - 0.5) * (base * 0.01)
            }));
            setChartData(data);
        }
    }, [selectedAsset]);

    // --- WALLET CONNECT ---
    const connectWallet = async () => {
        if (!window.ethereum) return showNotification('MetaMask required', 'error');
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await provider.send('eth_requestAccounts', []);
            const signer = await provider.getSigner();
            setUserWallet({ address: accounts[0], signer, provider });
            showNotification('Wallet Connected', 'success');
        } catch (error) {
            showNotification('Connection failed', 'error');
        }
    };

    useEffect(() => {
        if (userWallet && isAgentActivated) {
            fetchPositions();
            const interval = setInterval(fetchPositions, 5000);
            return () => clearInterval(interval);
        }
    }, [userWallet, isAgentActivated]);

    // --- CORE: AGENT ACTIVATION (THE FIX) ---
    const activateAgent = async () => {
        if (!userWallet || !agentWallet) return;

        try {
            showNotification('Please sign the Agent Approval in MetaMask...', 'info');

            // 1. Construct EIP-712 Data for Hyperliquid "Approve Agent"
            // This MUST match Hyperliquid's expected format exactly.
            const domain = {
                name: "HyperliquidSignTransaction",
                version: "1",
                chainId: HYPERLIQUID_MAINNET_ID,
                verifyingContract: "0x0000000000000000000000000000000000000000"
            };

            const types = {
                "HyperliquidTransaction:ApproveAgent": [
                    { name: "hyperliquidChain", type: "string" },
                    { name: "agentAddress", type: "address" },
                    { name: "agentName", type: "string" },
                    { name: "nonce", type: "uint64" }
                ]
            };

            const nonce = Date.now();
            const message = {
                hyperliquidChain: "Mainnet",
                agentAddress: agentWallet.address,
                agentName: "X/CHANGE Agent",
                nonce: nonce
            };

            // 2. Request User Signature
            const signatureRaw = await userWallet.signer.signTypedData(domain, types, message);
            const signature = ethers.Signature.from(signatureRaw);

            // 3. Send to Backend to Relay to Hyperliquid
            showNotification('Activating Agent on-chain...', 'info');

            const response = await axios.post(`${API_BASE_URL}/approve-agent`, {
                user_wallet_address: userWallet.address,
                agent_address: agentWallet.address,
                agent_name: "X/CHANGE Agent",
                nonce: nonce,
                signature: {
                    r: signature.r,
                    s: signature.s,
                    v: signature.v
                }
            });

            if (response.data.status === 'success') {
                setIsAgentActivated(true);
                localStorage.setItem('agent_activated', 'true');
                showNotification('Agent Activated! You can now trade.', 'success');
                fetchPositions();
            }

        } catch (error) {
            console.error('Activation Error:', error);
            showNotification('Failed to activate agent. Check console.', 'error');
        }
    };

    // --- TRADING ---
    const executeTrade = async (isBuy) => {
        if (!isAgentActivated || !selectedAsset) return;
        setIsTrading(true);
        try {
            await axios.post(`${API_BASE_URL}/trade`, {
                user_agent_private_key: agentWallet.privateKey,
                user_main_wallet_address: userWallet.address,
                coin: selectedAsset.symbol,
                is_buy: isBuy,
                usd_size: parseFloat(usdSize),
                leverage: leverage
            });
            showNotification(`Order Placed: ${isBuy ? 'LONG' : 'SHORT'} ${selectedAsset.symbol}`, 'success');
            setTimeout(fetchPositions, 1000);
        } catch (error) {
            showNotification(error.response?.data?.detail || 'Trade Failed', 'error');
        } finally {
            setIsTrading(false);
        }
    };

    const closePosition = async (coin) => {
        // FIXED: Added 'window.' to confirm()
        if (!window.confirm(`Close ${coin} position?`)) return;

        try {
            await axios.post(`${API_BASE_URL}/close-position`, {
                user_agent_private_key: agentWallet.privateKey,
                user_main_wallet_address: userWallet.address,
                coin: coin
            });
            showNotification('Position Closed', 'success');
            setTimeout(fetchPositions, 1000);
        } catch (error) {
            showNotification('Failed to close', 'error');
        }
    };

    const fetchPositions = async () => {
        if (!userWallet) return;
        setIsLoadingPositions(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/positions/${userWallet.address}`);
            setPositions(res.data.positions || []);
            setAccountValue(res.data.account_value);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingPositions(false);
        }
    };

    const showNotification = (msg, type) => {
        setNotification({ message: msg, type });
        setTimeout(() => setNotification(null), 5000);
    };

    // --- RENDER HELPERS ---
    const filteredAssets = assets.filter(a =>
        a.symbol.toLowerCase().includes(searchFilter.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-black text-white font-mono flex flex-col">
            {/* HEADER */}
            <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-black/95 sticky top-0 z-50">
                <div className="flex items-center gap-2">
                    <div className="text-2xl font-black tracking-tighter">X/<span className="text-gray-500">CHANGE</span></div>
                </div>

                <div className="flex gap-4 items-center">
                    {userWallet ? (
                        <div className="flex gap-3 items-center">
                            {!isAgentActivated && (
                                <button onClick={activateAgent} className="px-4 py-2 bg-yellow-500 text-black font-bold text-xs hover:bg-yellow-400">
                                    ACTIVATE AGENT
                                </button>
                            )}
                            {accountValue && (
                                <div className="text-right hidden md:block">
                                    <div className="text-[10px] text-gray-500">EQUITY</div>
                                    <div className="font-bold">${accountValue.total_value?.toFixed(2)}</div>
                                </div>
                            )}
                            <div className="px-3 py-2 bg-gray-900 border border-gray-800 text-xs font-bold flex gap-2 items-center">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                {userWallet.address.slice(0, 6)}...{userWallet.address.slice(-4)}
                            </div>
                        </div>
                    ) : (
                        <button onClick={connectWallet} className="px-6 py-2 bg-white text-black font-bold text-xs hover:bg-gray-200">
                            CONNECT WALLET
                        </button>
                    )}
                </div>
            </header>

            {/* NOTIFICATIONS */}
            {notification && (
                <div className={`fixed top-20 right-6 z-50 p-4 border flex items-center gap-3 animate-bounce-in
          ${notification.type === 'error' ? 'bg-red-900/20 border-red-500 text-red-500' : 'bg-green-900/20 border-green-500 text-green-500'}`}>
                    {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                    <span className="text-sm font-bold">{notification.message}</span>
                </div>
            )}

            {/* MAIN CONTENT */}
            <div className="flex flex-1 overflow-hidden">

                {/* ASSET LIST */}
                <div className="w-64 border-r border-gray-800 flex flex-col">
                    <div className="p-3 border-b border-gray-800 relative">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-600" size={14} />
                        <input
                            className="w-full bg-gray-900 border border-gray-700 py-1 pl-8 pr-2 text-xs text-white focus:outline-none focus:border-white transition-colors"
                            placeholder="Search..."
                            value={searchFilter}
                            onChange={e => setSearchFilter(e.target.value)}
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {filteredAssets.map(asset => (
                            <button
                                key={asset.symbol}
                                onClick={() => setSelectedAsset(asset)}
                                className={`w-full px-4 py-3 flex justify-between items-center border-b border-gray-900 hover:bg-gray-900/50 transition-colors
                  ${selectedAsset?.symbol === asset.symbol ? 'bg-gray-900 border-l-2 border-l-white' : ''}`}
                            >
                                <div className="text-left">
                                    <div className="font-bold text-sm">{asset.symbol}</div>
                                    <div className="text-[10px] text-gray-500">PERP</div>
                                </div>
                                <div className="font-mono text-sm">${asset.price.toFixed(asset.price < 1 ? 4 : 2)}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* CHART & POSITIONS */}
                <div className="flex-1 flex flex-col bg-black">
                    {selectedAsset && (
                        <div className="h-2/3 p-6 flex flex-col border-b border-gray-800">
                            <div className="mb-4">
                                <h2 className="text-3xl font-black">{selectedAsset.symbol}USD</h2>
                                <div className="text-xl font-mono text-gray-400">${selectedAsset.price}</div>
                            </div>
                            <div className="flex-1 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData}>
                                        <XAxis dataKey="time" hide />
                                        <YAxis domain={['auto', 'auto']} orientation="right" tick={{ fill: '#333', fontSize: 10 }} stroke="#333" />
                                        <Line type="stepAfter" dataKey="price" stroke="#fff" strokeWidth={1} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* POSITIONS TABLE */}
                    <div className="flex-1 bg-black p-4 overflow-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-gray-500">OPEN POSITIONS</h3>
                            <RefreshCw size={14} className={`text-gray-600 ${isLoadingPositions ? 'animate-spin' : ''}`} />
                        </div>
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-gray-600 border-b border-gray-800">
                                    <th className="text-left py-2">ASSET</th>
                                    <th className="text-right py-2">SIZE</th>
                                    <th className="text-right py-2">ENTRY</th>
                                    <th className="text-right py-2">PNL</th>
                                    <th className="text-right py-2">ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {positions.map((pos, i) => (
                                    <tr key={i} className="border-b border-gray-900">
                                        <td className="py-3 font-bold">{pos.coin}</td>
                                        <td className={`py-3 text-right ${pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>
                                            {pos.size}
                                        </td>
                                        <td className="py-3 text-right">${pos.entry_price.toFixed(2)}</td>
                                        <td className={`py-3 text-right ${pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            ${pos.unrealized_pnl.toFixed(2)}
                                        </td>
                                        <td className="py-3 text-right">
                                            <button onClick={() => closePosition(pos.coin)} className="text-[10px] underline hover:text-white">
                                                CLOSE
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {positions.length === 0 && (
                                    <tr><td colSpan="5" className="py-8 text-center text-gray-600">No open positions</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ORDER FORM */}
                <div className="w-80 border-l border-gray-800 p-6 flex flex-col gap-6 bg-black">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 block mb-2">SIZE (USD)</label>
                        <input
                            type="number"
                            value={usdSize}
                            onChange={e => setUsdSize(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 p-3 text-lg font-bold text-white focus:border-white focus:outline-none"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-[10px] font-bold text-gray-500">LEVERAGE</label>
                            <span className="text-xs font-bold">{leverage}x</span>
                        </div>
                        <input
                            type="range" min="1" max="50" value={leverage}
                            onChange={e => setLeverage(Number(e.target.value))}
                            className="w-full accent-white"
                        />
                    </div>

                    <div className="mt-auto space-y-3">
                        <button
                            onClick={() => executeTrade(true)}
                            disabled={isTrading || !isAgentActivated}
                            className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-black flex justify-center gap-2"
                        >
                            {isTrading ? <RefreshCw className="animate-spin" /> : <TrendingUp />} BUY / LONG
                        </button>
                        <button
                            onClick={() => executeTrade(false)}
                            disabled={isTrading || !isAgentActivated}
                            className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-black flex justify-center gap-2"
                        >
                            {isTrading ? <RefreshCw className="animate-spin" /> : <TrendingDown />} SELL / SHORT
                        </button>
                    </div>

                    {!isAgentActivated && userWallet && (
                        <div className="p-3 border border-yellow-900/50 bg-yellow-900/10 text-yellow-500 text-xs text-center">
                            ⚠️ Agent activation required to trade
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;