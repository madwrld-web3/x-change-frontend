import React, { useState, useEffect } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import axios from 'axios';
import {
    TrendingUp, TrendingDown, Search, CheckCircle,
    AlertCircle, RefreshCw, Wallet, Loader2, ExternalLink
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'https://x-backend-production-c71b.up.railway.app';
const ARBITRUM_CHAIN_ID = '0xa4b1';
const HYPERLIQUID_BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const USDC_ABI = ["function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)"];

function App() {
    const [userWallet, setUserWallet] = useState(null);
    const [accountStatus, setAccountStatus] = useState(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    
    const [assets, setAssets] = useState([]);
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [usdSize, setUsdSize] = useState('100');
    const [leverage, setLeverage] = useState(1);
    const [isTrading, setIsTrading] = useState(false);

    const [agentAddress, setAgentAddress] = useState(null);
    const [showAgentInstructions, setShowAgentInstructions] = useState(false);

    const [depositAmount, setDepositAmount] = useState("");
    const [isDepositing, setIsDepositing] = useState(false);
    const [depositMessage, setDepositMessage] = useState("");
    const [showDepositModal, setShowDepositModal] = useState(false);

    const [notification, setNotification] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState(null);
    const [isLoadingPositions, setIsLoadingPositions] = useState(false);

    useEffect(() => { fetchMarkets(); }, []);

    const fetchMarkets = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/markets`);
            setAssets(response.data);
            if (response.data.length > 0 && !selectedAsset) setSelectedAsset(response.data[0]);
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        if (selectedAsset) {
            const base = selectedAsset.price;
            const data = Array.from({ length: 20 }, (_, i) => ({
                time: i,
                price: base + (Math.random() - 0.5) * (base * 0.01)
            }));
            setChartData(data);
        }
    }, [selectedAsset]);

    const connectWallet = async () => {
        if (!window.ethereum) return alert('Install MetaMask/Rabby');
        try {
            const provider = new BrowserProvider(window.ethereum);
            await provider.send('eth_requestAccounts', []);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();

            const network = await provider.getNetwork();
            if (network.chainId !== 42161n) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: ARBITRUM_CHAIN_ID }],
                    });
                } catch (e) {
                    return alert("Switch to Arbitrum One");
                }
            }

            setUserWallet({ address, signer, provider });
            checkAccountStatus(address);
            await generateAgentAddress(address);
        } catch (error) {
            console.error(error);
        }
    };

    const generateAgentAddress = async (userAddress) => {
        try {
            const response = await axios.post(`${API_BASE_URL}/generate-agent`, { user_address: userAddress });
            setAgentAddress(response.data.agentAddress);
            console.log("Agent:", response.data.agentAddress);
        } catch (error) {
            console.error(error);
        }
    };

    const checkAccountStatus = async (address) => {
        setIsCheckingStatus(true);
        try {
            const response = await axios.post(`${API_BASE_URL}/api/account-status`, { wallet_address: address });
            setAccountStatus(response.data);
            if (response.data.exists) {
                fetchPositions(address);
                const interval = setInterval(() => fetchPositions(address), 5000);
                return () => clearInterval(interval);
            } else {
                setShowDepositModal(true);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsCheckingStatus(false);
        }
    };

    const handleDeposit = async () => {
        if (!depositAmount || parseFloat(depositAmount) < 10) return alert("Min 10 USDC");
        setIsDepositing(true);
        setDepositMessage("Check wallet...");
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const usdcContract = new Contract(ARBITRUM_USDC, USDC_ABI, signer);
            const decimals = await usdcContract.decimals();
            const amount = ethers.parseUnits(depositAmount, decimals);
            setDepositMessage("Approve...");
            const tx = await usdcContract.transfer(HYPERLIQUID_BRIDGE, amount);
            setDepositMessage("Processing...");
            await tx.wait();
            setDepositMessage("✓ Confirmed!");
            setTimeout(() => {
                setShowDepositModal(false);
                checkAccountStatus(userWallet.address);
                setDepositMessage("");
            }, 2000);
        } catch (error) {
            console.error(error);
            setDepositMessage("Failed");
        } finally {
            setIsDepositing(false);
        }
    };

    const executeTrade = async (isBuy) => {
        if (!userWallet || !selectedAsset) return;
        
        setIsTrading(true);
        try {
            await axios.post(`${API_BASE_URL}/trade`, {
                user_address: userWallet.address,
                coin: selectedAsset.symbol,
                is_buy: isBuy,
                usd_size: parseFloat(usdSize),
                leverage: leverage
            });
            showNotification(`✓ ${isBuy ? 'Long' : 'Short'} opened!`, "success");
            fetchPositions(userWallet.address);
        } catch (error) {
            const errorMsg = error.response?.data?.detail || error.message;
            if (errorMsg.toLowerCase().includes("must deposit") || errorMsg.toLowerCase().includes("does not exist")) {
                setShowAgentInstructions(true);
            }
            showNotification(`Failed: ${errorMsg}`, "error");
        } finally {
            setIsTrading(false);
        }
    };

    const fetchPositions = async (address) => {
        setIsLoadingPositions(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/positions/${address}`);
            setPositions(res.data.positions || []);
            setAccountValue(res.data.account_value);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingPositions(false);
        }
    };
    
    const closePosition = async (coin) => {
        if(!window.confirm(`Close ${coin}?`)) return;
        try {
            await axios.post(`${API_BASE_URL}/close-position`, { user_address: userWallet.address, coin });
            showNotification("Closed", "success");
            fetchPositions(userWallet.address);
        } catch(e) {
            showNotification("Failed", "error");
        }
    };

    const showNotification = (msg, type) => {
        setNotification({ message: msg, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const filteredAssets = assets.filter(a => a.symbol.toLowerCase().includes(searchFilter.toLowerCase()));

    return (
        <div className="min-h-screen bg-black text-white font-mono flex flex-col">
            <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-black/95 sticky top-0 z-50">
                <div className="text-2xl font-black">X/<span className="text-gray-500">CHANGE</span></div>
                <div className="flex gap-4 items-center">
                    {userWallet ? (
                        <div className="flex gap-3 items-center">
                            <button onClick={() => setShowDepositModal(true)} className="px-3 py-2 bg-gray-900 border border-gray-800 hover:border-blue-500 text-xs font-bold flex gap-2 items-center">
                                <Wallet size={12} /> DEPOSIT
                            </button>
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
                        <button onClick={connectWallet} className="px-6 py-2 bg-white text-black font-bold text-xs hover:bg-gray-200">CONNECT</button>
                    )}
                </div>
            </header>

            {notification && (
                <div className={`fixed top-20 right-6 z-50 p-4 border flex items-center gap-3 rounded ${notification.type === 'error' ? 'bg-red-900/90 border-red-500' : 'bg-green-900/90 border-green-500'}`}>
                    {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                    <span className="text-sm font-bold">{notification.message}</span>
                </div>
            )}

            {showAgentInstructions && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-900 border border-gray-700 p-8 rounded-xl max-w-2xl w-full">
                        <h2 className="text-2xl font-bold mb-4">🔧 Agent Setup Required</h2>
                        <p className="text-gray-300 mb-6">To trade, approve the agent wallet on Hyperliquid (one-time, 30 seconds):</p>
                        <div className="bg-black p-4 rounded mb-6 space-y-3 text-sm">
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">1.</span>
                                <div>
                                    <div className="font-bold">Copy agent address:</div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="bg-gray-800 px-2 py-1 rounded text-xs">{agentAddress}</code>
                                        <button onClick={() => {navigator.clipboard.writeText(agentAddress); showNotification("Copied!", "success");}} className="text-blue-500 text-xs">Copy</button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">2.</span>
                                <div>Visit <a href="https://app.hyperliquid.xyz/API" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-1">app.hyperliquid.xyz/API <ExternalLink size={12} /></a></div>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">3.</span>
                                <div>Click "Create API Wallet" → "Import existing"</div>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">4.</span>
                                <div>Paste agent address, name it "X/CHANGE Agent"</div>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">5.</span>
                                <div>Click "Authorize API Wallet" and sign</div>
                            </div>
                            <div className="flex items-start gap-3">
                                <span className="text-blue-500 font-bold">6.</span>
                                <div>Return here and start trading!</div>
                            </div>
                        </div>
                        <button onClick={() => setShowAgentInstructions(false)} className="w-full py-3 bg-blue-600 hover:bg-blue-500 font-bold rounded">Got it!</button>
                    </div>
                </div>
            )}

            <div className="flex flex-1 overflow-hidden">
                {!userWallet ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8">
                        <Wallet size={64} className="text-gray-700 mb-6" />
                        <h2 className="text-3xl font-black mb-4">Connect to Trade</h2>
                        <button onClick={connectWallet} className="px-8 py-3 bg-white text-black font-bold text-lg">Connect</button>
                    </div>
                ) : isCheckingStatus ? (
                    <div className="flex flex-1 flex-col items-center justify-center">
                        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                        <p className="text-gray-500">Verifying...</p>
                    </div>
                ) : showDepositModal ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8">
                        <div className="max-w-md w-full bg-gray-900/50 border border-gray-800 p-8 rounded-xl">
                            <h2 className="text-2xl font-bold mb-8 text-center">Deposit USDC</h2>
                            <div className="space-y-4">
                                <div className="relative">
                                    <input type="number" placeholder="Min 10.0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full bg-black border border-gray-700 p-4 rounded text-white font-mono" />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold">USDC</span>
                                </div>
                                <button onClick={handleDeposit} disabled={isDepositing} className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded">{isDepositing ? "Processing..." : "Deposit"}</button>
                                {depositMessage && <div className="text-center text-blue-400 text-xs">{depositMessage}</div>}
                                {accountStatus?.exists && <button onClick={() => setShowDepositModal(false)} className="w-full text-xs text-gray-500 mt-2">Cancel</button>}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="w-64 border-r border-gray-800 flex flex-col hidden lg:flex">
                            <div className="p-3 border-b border-gray-800 relative">
                                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-600" size={14} />
                                <input className="w-full bg-gray-900 border border-gray-700 py-1 pl-8 pr-2 text-xs text-white focus:outline-none" placeholder="Search..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} />
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                {filteredAssets.map(asset => (
                                    <button key={asset.symbol} onClick={() => setSelectedAsset(asset)} className={`w-full px-4 py-3 flex justify-between items-center border-b border-gray-900 hover:bg-gray-900/50 ${selectedAsset?.symbol === asset.symbol ? 'bg-gray-900 border-l-2 border-l-white' : ''}`}>
                                        <div className="text-left">
                                            <div className="font-bold text-sm">{asset.symbol}</div>
                                            <div className="text-[10px] text-gray-500">PERP</div>
                                        </div>
                                        <div className="font-mono text-sm">${asset.price.toFixed(asset.price < 1 ? 4 : 2)}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col bg-black">
                            {selectedAsset && (
                                <div className="h-2/3 p-6 flex flex-col border-b border-gray-800">
                                    <div className="mb-4">
                                        <h2 className="text-3xl font-black">{selectedAsset.symbol}USD</h2>
                                        <div className="text-xl font-mono text-gray-400">${selectedAsset.price.toFixed(selectedAsset.price < 1 ? 4 : 2)}</div>
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

                            <div className="flex-1 bg-black p-4 overflow-auto">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-gray-500">POSITIONS</h3>
                                    <RefreshCw size={14} className={`text-gray-600 cursor-pointer ${isLoadingPositions ? 'animate-spin' : ''}`} onClick={() => fetchPositions(userWallet.address)} />
                                </div>
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-gray-600 border-b border-gray-800">
                                            <th className="text-left py-2">ASSET</th>
                                            <th className="text-right py-2">SIZE</th>
                                            <th className="text-right py-2">ENTRY</th>
                                            <th className="text-right py-2">PNL</th>
                                            <th className="text-right py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {positions.map((pos, i) => (
                                            <tr key={i} className="border-b border-gray-900">
                                                <td className="py-3 font-bold">{pos.coin}</td>
                                                <td className={`py-3 text-right font-bold ${pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>{pos.size.toFixed(4)}</td>
                                                <td className="py-3 text-right">${pos.entry_price.toFixed(2)}</td>
                                                <td className={`py-3 text-right font-bold ${pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>${pos.unrealized_pnl.toFixed(2)}</td>
                                                <td className="py-3 text-right">
                                                    <button onClick={() => closePosition(pos.coin)} className="text-[10px] px-2 py-1 bg-red-900/20 border border-red-500/50 rounded">CLOSE</button>
                                                </td>
                                            </tr>
                                        ))}
                                        {positions.length === 0 && <tr><td colSpan="5" className="py-8 text-center text-gray-600">No positions</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="w-80 border-l border-gray-800 p-6 flex flex-col gap-6 bg-black">
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-2">SIZE (USD)</label>
                                <input type="number" value={usdSize} onChange={e => setUsdSize(e.target.value)} className="w-full bg-gray-900 border border-gray-700 p-3 text-lg font-bold text-white focus:border-white focus:outline-none" />
                            </div>
                            
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-[10px] font-bold text-gray-500">LEVERAGE</label>
                                    <span className="text-xs font-bold">{leverage}x</span>
                                </div>
                                <input type="range" min="1" max="50" value={leverage} onChange={e => setLeverage(Number(e.target.value))} className="w-full accent-white" />
                            </div>
                            
                            <div className="mt-auto space-y-3">
                                <button onClick={() => executeTrade(true)} disabled={isTrading} className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-black font-black flex justify-center items-center gap-2">
                                    {isTrading ? <RefreshCw className="animate-spin" size={18} /> : <TrendingUp size={18} />}
                                    BUY / LONG
                                </button>
                                <button onClick={() => executeTrade(false)} disabled={isTrading} className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-black font-black flex justify-center items-center gap-2">
                                    {isTrading ? <RefreshCw className="animate-spin" size={18} /> : <TrendingDown size={18} />}
                                    SELL / SHORT
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default App;