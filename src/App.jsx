import React, { useState, useEffect } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import { createWalletClient, custom } from 'viem';
import { arbitrum } from 'viem/chains';
import { Hyperliquid } from '@nktkas/hyperliquid';
import axios from 'axios';
import {
    TrendingUp, TrendingDown, Search, RefreshCw, Wallet, Loader2
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// CONFIGURATION
const API_BASE_URL = 'https://x-backend-production-c71b.up.railway.app'; // Your Backend URL
const ARBITRUM_CHAIN_ID = '0xa4b1'; // 42161
const HYPERLIQUID_BRIDGE_ADDRESS = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const ARBITRUM_USDC_ADDRESS = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

function App() {
    const [userWallet, setUserWallet] = useState(null);
    const [accountStatus, setAccountStatus] = useState(null); 
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    
    // Trade State
    const [assets, setAssets] = useState([]);
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [usdSize, setUsdSize] = useState('100');
    const [leverage, setLeverage] = useState(1);
    const [isTrading, setIsTrading] = useState(false);
    
    // Deposit State
    const [depositAmount, setDepositAmount] = useState("");
    const [isDepositing, setIsDepositing] = useState(false);
    const [depositMessage, setDepositMessage] = useState("");
    const [showDepositModal, setShowDepositModal] = useState(false);

    // UI
    const [notification, setNotification] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState(null);
    const [isLoadingPositions, setIsLoadingPositions] = useState(false);

    // Initial Load
    useEffect(() => {
        fetchMarkets();
    }, []);

    // Fake Chart Data (Replace with real history if needed)
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

    // --- DATA FETCHING ---
    const fetchMarkets = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/markets`);
            setAssets(response.data);
            if (response.data.length > 0 && !selectedAsset) setSelectedAsset(response.data[0]);
        } catch (error) {
            console.error("Failed to fetch markets:", error);
        }
    };

    const fetchPositions = async (address) => {
        if (!address) return;
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

    const checkAccountStatus = async (address) => {
        setIsCheckingStatus(true);
        try {
            const response = await axios.post(`${API_BASE_URL}/api/account-status`, { wallet_address: address });
            setAccountStatus(response.data);
            
            // If account exists, start polling for positions
            if (response.data.exists) {
                fetchPositions(address); // Immediate fetch
                const interval = setInterval(() => fetchPositions(address), 5000);
                return () => clearInterval(interval);
            } else {
                setShowDepositModal(true); // Prompt deposit if new user
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsCheckingStatus(false);
        }
    };

    // --- WALLET CONNECTION ---
    const connectWallet = async () => {
        if (!window.ethereum) return alert('Wallet required (MetaMask/Rabby)');
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();

            // Switch Chain to Arbitrum
            const network = await provider.getNetwork();
            if (network.chainId !== 42161n) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: ARBITRUM_CHAIN_ID }],
                    });
                } catch (e) {
                    return alert("Please switch to Arbitrum One");
                }
            }

            setUserWallet({ address, signer, provider });
            checkAccountStatus(address);
            showNotification("Wallet Connected", "success");
        } catch (error) {
            console.error(error);
        }
    };

    // --- TRADING LOGIC (DIRECT SIGNING) ---
    const executeTrade = async (isBuy) => {
        if (!userWallet || !selectedAsset) return;
        setIsTrading(true);

        try {
            // 1. Setup SDK with Viem (Standard for Hyperliquid)
            const walletClient = createWalletClient({
                account: userWallet.address,
                chain: arbitrum,
                transport: custom(window.ethereum)
            });
            
            const sdk = new Hyperliquid(walletClient, { testnet: false, enableBatching: false });
            await sdk.connect(); // Ensure internal state is ready

            // 2. Get Fresh Price
            const allMids = await sdk.info.getAllMids();
            const price = parseFloat(allMids[selectedAsset.symbol]);
            if (!price) throw new Error("Could not fetch latest price");

            // 3. Calculate Size & Limit
            const slippage = 0.05; // 5% Market Order buffer
            const limitPx = isBuy ? price * (1 + slippage) : price * (1 - slippage);
            
            // Convert USD to Tokens
            const sizeInUsd = parseFloat(usdSize);
            const sizeInTokens = sizeInUsd / price;
            
            // Round to 4 decimals for safety
            const formattedSize = Number(sizeInTokens.toFixed(4));
            const formattedPrice = Number(limitPx.toFixed(4)); // Limit price must also be number

            console.log(`Trading: ${isBuy?'Buy':'Sell'} ${formattedSize} ${selectedAsset.symbol} @ ${formattedPrice}`);

            // 4. Send Order
            const result = await sdk.exchange.placeOrder({
                coin: selectedAsset.symbol,
                is_buy: isBuy,
                sz: formattedSize,
                limit_px: formattedPrice,
                order_type: { limit: { tif: 'Ioc' } }, // Immediate or Cancel (Market)
                reduce_only: false
            });

            // 5. Check Result
            if (result.status === 'ok') {
                const status = result.response.data.statuses[0];
                if (status.filled) {
                    showNotification("Order Filled!", "success");
                    fetchPositions(userWallet.address);
                } else {
                    showNotification(`Order placed but not filled: ${JSON.stringify(status)}`, "info");
                }
            } else {
                throw new Error(result.response?.data?.toString() || "Trade Failed");
            }

        } catch (error) {
            console.error("Trade Error:", error);
            if (error.message.includes("User rejected")) {
                showNotification("Transaction Rejected", "error");
            } else {
                showNotification("Trade Failed", "error");
            }
        } finally {
            setIsTrading(false);
        }
    };

    const closePosition = async (coin) => {
        if (!window.confirm(`Close ${coin} position?`)) return;
        
        try {
            // Setup SDK
            const walletClient = createWalletClient({
                account: userWallet.address,
                chain: arbitrum,
                transport: custom(window.ethereum)
            });
            const sdk = new Hyperliquid(walletClient, { testnet: false, enableBatching: false });
            await sdk.connect();

            // Find Position to get size
            const pos = positions.find(p => p.coin === coin);
            if (!pos) throw new Error("Position not found in local state");

            // Close = Open opposite order with reduce_only: true
            const isBuy = pos.side === 'SHORT'; // If short, we buy to close
            const size = Math.abs(parseFloat(pos.size));
            
            // Get Price for aggressive fill
            const allMids = await sdk.info.getAllMids();
            const price = parseFloat(allMids[coin]);
            const slippage = 0.05;
            const limitPx = isBuy ? price * (1 + slippage) : price * (1 - slippage);

            const result = await sdk.exchange.placeOrder({
                coin: coin,
                is_buy: isBuy,
                sz: size,
                limit_px: Number(limitPx.toFixed(4)),
                order_type: { limit: { tif: 'Ioc' } },
                reduce_only: true // IMPORTANT: Ensures we don't flip position
            });

            if (result.status === 'ok') {
                showNotification("Position Closed", "success");
                fetchPositions(userWallet.address);
            } else {
                throw new Error("Failed to close");
            }

        } catch (error) {
            console.error(error);
            showNotification("Failed to close position", "error");
        }
    };

    // --- DEPOSIT LOGIC ---
    const handleDeposit = async () => {
        if (!depositAmount || parseFloat(depositAmount) < 10) return alert("Min 10 USDC");
        setIsDepositing(true);
        setDepositMessage("Check wallet...");
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const usdcContract = new Contract(ARBITRUM_USDC_ADDRESS, USDC_ABI, signer);
            const amountInWei = ethers.parseUnits(depositAmount, 6);
            
            const tx = await usdcContract.transfer(HYPERLIQUID_BRIDGE_ADDRESS, amountInWei);
            setDepositMessage("Sending...");
            await tx.wait();
            setDepositMessage("Confirmed! Waiting for credit...");
            
            // Poll for account existence
            let attempts = 0;
            const interval = setInterval(async () => {
                attempts++;
                const res = await axios.post(`${API_BASE_URL}/api/account-status`, { wallet_address: userWallet.address });
                if (res.data.exists) {
                    clearInterval(interval);
                    setAccountStatus(res.data);
                    setIsDepositing(false);
                    setShowDepositModal(false);
                    showNotification("Account Credited!", "success");
                }
                if (attempts > 30) { 
                    clearInterval(interval); 
                    setIsDepositing(false); 
                    setDepositMessage("Deposit confirmed on-chain. Refresh shortly."); 
                }
            }, 3000);
        } catch (error) {
            console.error(error);
            setIsDepositing(false);
            setDepositMessage("Transaction Failed");
        }
    };

    const showNotification = (msg, type) => {
        setNotification({ message: msg, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const filteredAssets = assets.filter(a => a.symbol.toLowerCase().includes(searchFilter.toLowerCase()));

    // --- RENDER HELPERS ---
    const DepositComponent = () => (
        <div className="max-w-md w-full bg-gray-900/50 border border-gray-800 p-8 rounded-xl backdrop-blur-sm mx-auto">
            <div className="text-center mb-8"><h2 className="text-2xl font-bold">Deposit Funds</h2></div>
            <div className="space-y-4">
                <div className="relative"><input type="number" placeholder="Min 10.0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full bg-black border border-gray-700 p-4 rounded text-white font-mono" /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold">USDC</span></div>
                <button onClick={handleDeposit} disabled={isDepositing} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded">{isDepositing ? "Processing..." : "Deposit"}</button>
                {depositMessage && <div className="text-center text-blue-400 text-xs">{depositMessage}</div>}
                {showDepositModal && accountStatus?.exists && <button onClick={() => setShowDepositModal(false)} className="w-full text-xs text-gray-500 mt-2">Cancel</button>}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-black text-white font-mono flex flex-col">
            <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-black/95 sticky top-0 z-50">
                <div className="text-2xl font-black tracking-tighter">X/<span className="text-gray-500">CHANGE</span></div>
                <div className="flex gap-4 items-center">
                    {userWallet ? (
                        <div className="flex gap-3 items-center">
                            <button onClick={() => setShowDepositModal(true)} className="px-3 py-2 bg-gray-900 border border-gray-800 hover:border-blue-500 text-xs font-bold flex gap-2 items-center"><Wallet size={12} /> DEPOSIT</button>
                            {accountValue && <div className="text-right hidden md:block"><div className="text-[10px] text-gray-500">EQUITY</div><div className="font-bold">${accountValue.total_value?.toFixed(2)}</div></div>}
                            <div className="px-3 py-2 bg-gray-900 border border-gray-800 text-xs font-bold flex gap-2 items-center"><div className="w-2 h-2 rounded-full bg-green-500"></div>{userWallet.address.slice(0, 6)}...</div>
                        </div>
                    ) : (
                        <button onClick={connectWallet} className="px-6 py-2 bg-white text-black font-bold text-xs hover:bg-gray-200">CONNECT WALLET</button>
                    )}
                </div>
            </header>
            
            {notification && <div className={`fixed top-20 right-6 z-50 p-4 border flex items-center gap-3 animate-bounce-in ${notification.type === 'error' ? 'bg-red-900/20 text-red-500' : 'bg-green-900/20 text-green-500'}`}><span className="text-sm font-bold">{notification.message}</span></div>}
            
            <div className="flex flex-1 overflow-hidden">
                {!userWallet ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><Wallet size={64} className="text-gray-700 mb-6" /><h2 className="text-3xl font-black mb-4">Connect to Trade</h2><button onClick={connectWallet} className="px-8 py-3 bg-white text-black font-bold text-lg hover:bg-gray-200">Connect Wallet</button></div>
                ) : isCheckingStatus ? (
                    <div className="flex flex-1 flex-col items-center justify-center"><Loader2 className="animate-spin text-blue-500 mb-4" size={48} /><p className="text-gray-500">Verifying Account...</p></div>
                ) : showDepositModal ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8 bg-black"><DepositComponent /></div>
                ) : (
                    <>
                        <div className="w-64 border-r border-gray-800 flex flex-col hidden lg:flex">
                            <div className="p-3 border-b border-gray-800 relative"><Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-600" size={14} /><input className="w-full bg-gray-900 border border-gray-700 py-1 pl-8 pr-2 text-xs text-white focus:outline-none" placeholder="Search..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} /></div>
                            <div className="flex-1 overflow-y-auto">{filteredAssets.map(asset => (<button key={asset.symbol} onClick={() => setSelectedAsset(asset)} className={`w-full px-4 py-3 flex justify-between items-center border-b border-gray-900 hover:bg-gray-900/50 ${selectedAsset?.symbol === asset.symbol ? 'bg-gray-900 border-l-2 border-l-white' : ''}`}><div className="text-left"><div className="font-bold text-sm">{asset.symbol}</div><div className="text-[10px] text-gray-500">PERP</div></div><div className="font-mono text-sm">${asset.price.toFixed(asset.price < 1 ? 4 : 2)}</div></button>))}</div>
                        </div>
                        <div className="flex-1 flex flex-col bg-black">
                            {selectedAsset && <div className="h-2/3 p-6 flex flex-col border-b border-gray-800"><div className="mb-4"><h2 className="text-3xl font-black">{selectedAsset.symbol}USD</h2><div className="text-xl font-mono text-gray-400">${selectedAsset.price}</div></div><div className="flex-1 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="time" hide /><YAxis domain={['auto', 'auto']} orientation="right" tick={{ fill: '#333', fontSize: 10 }} stroke="#333" /><Line type="stepAfter" dataKey="price" stroke="#fff" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer></div></div>}
                            <div className="flex-1 bg-black p-4 overflow-auto"><div className="flex justify-between items-center mb-4"><h3 className="text-sm font-bold text-gray-500">OPEN POSITIONS</h3><RefreshCw size={14} className={`text-gray-600 ${isLoadingPositions ? 'animate-spin' : ''}`} /></div><table className="w-full text-xs"><thead><tr className="text-gray-600 border-b border-gray-800"><th className="text-left py-2">ASSET</th><th className="text-right py-2">SIZE</th><th className="text-right py-2">ENTRY</th><th className="text-right py-2">PNL</th><th className="text-right py-2">ACTION</th></tr></thead><tbody>{positions.map((pos, i) => (<tr key={i} className="border-b border-gray-900"><td className="py-3 font-bold">{pos.coin}</td><td className={`py-3 text-right ${pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>{pos.size}</td><td className="py-3 text-right">${pos.entry_price.toFixed(2)}</td><td className={`py-3 text-right ${pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>${pos.unrealized_pnl.toFixed(2)}</td><td className="py-3 text-right"><button onClick={() => closePosition(pos.coin)} className="text-[10px] underline hover:text-white">CLOSE</button></td></tr>))}{positions.length === 0 && <tr><td colSpan="5" className="py-8 text-center text-gray-600">No open positions</td></tr>}</tbody></table></div>
                        </div>
                        <div className="w-80 border-l border-gray-800 p-6 flex flex-col gap-6 bg-black">
                            <div><label className="text-[10px] font-bold text-gray-500 block mb-2">SIZE (USD)</label><input type="number" value={usdSize} onChange={e => setUsdSize(e.target.value)} className="w-full bg-gray-900 border border-gray-700 p-3 text-lg font-bold text-white focus:border-white focus:outline-none" /></div>
                            <div><div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-gray-500">LEVERAGE</label><span className="text-xs font-bold">{leverage}x</span></div><input type="range" min="1" max="50" value={leverage} onChange={e => setLeverage(Number(e.target.value))} className="w-full accent-white" /></div>
                            <div className="mt-auto space-y-3">
                                <button onClick={() => executeTrade(true)} disabled={isTrading} className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-black font-black flex justify-center gap-2">{isTrading ? <RefreshCw className="animate-spin" /> : <TrendingUp />} BUY / LONG</button>
                                <button onClick={() => executeTrade(false)} disabled={isTrading} className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-black font-black flex justify-center gap-2">{isTrading ? <RefreshCw className="animate-spin" /> : <TrendingDown />} SELL / SHORT</button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default App;