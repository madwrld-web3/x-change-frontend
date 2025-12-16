import React, { useState, useEffect } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import { createWalletClient, custom } from 'viem';
import { arbitrum } from 'viem/chains';
import { ExchangeClient, InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import axios from 'axios';
import {
    TrendingUp, TrendingDown, Search, RefreshCw, Wallet, Loader2
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// CONFIGURATION
const API_BASE_URL = 'https://x-backend-production-c71b.up.railway.app'; // Your Backend
const ARBITRUM_CHAIN_ID = '0xa4b1'; // 42161
const HYPERLIQUID_BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

function App() {
    const [userWallet, setUserWallet] = useState(null);
    const [accountStatus, setAccountStatus] = useState(null);
    
    // Market Data
    const [assets, setAssets] = useState([]);
    const [assetMap, setAssetMap] = useState({}); // Maps Symbol -> ID (CRITICAL FOR TRADING)
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');
    
    // Trading Inputs
    const [usdSize, setUsdSize] = useState('100');
    const [leverage, setLeverage] = useState(1);
    const [isTrading, setIsTrading] = useState(false);
    
    // UI State
    const [depositAmount, setDepositAmount] = useState("");
    const [isDepositing, setIsDepositing] = useState(false);
    const [showDepositModal, setShowDepositModal] = useState(false);
    const [notification, setNotification] = useState(null);
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState(null);
    const [chartData, setChartData] = useState([]);

    // 1. INITIAL LOAD: Fetch Markets AND Metadata (Asset IDs)
    useEffect(() => {
        const initData = async () => {
            try {
                // Fetch Prices from your backend
                const marketRes = await axios.get(`${API_BASE_URL}/markets`);
                setAssets(marketRes.data);
                if (marketRes.data.length > 0) setSelectedAsset(marketRes.data[0]);

                // Fetch Asset IDs from Hyperliquid directly (Needed for placing orders)
                const transport = new HttpTransport(); // Mainnet
                const info = new InfoClient({ transport });
                const meta = await info.meta();
                
                // Create a map: { "BTC": 0, "ETH": 1, ... }
                const map = {};
                meta.universe.forEach((u, index) => {
                    map[u.name] = index;
                });
                setAssetMap(map);
                console.log("Asset Map Loaded:", map);
            } catch (e) {
                console.error("Failed to load market data:", e);
            }
        };
        initData();
    }, []);

    // Fake Chart Data
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

    // --- WALLET ---
    const connectWallet = async () => {
        if (!window.ethereum) return alert('Wallet required');
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const address = await signer.getAddress();
            
            const network = await provider.getNetwork();
            if (network.chainId !== 42161n) {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: ARBITRUM_CHAIN_ID }],
                });
            }

            setUserWallet({ address, signer });
            fetchPositions(address);
        } catch (e) { console.error(e); }
    };

    const fetchPositions = async (address) => {
        if(!address) return;
        try {
            const res = await axios.get(`${API_BASE_URL}/positions/${address}`);
            setPositions(res.data.positions || []);
            setAccountValue(res.data.account_value);
        } catch(e) { console.error(e); }
    };

    // --- TRADING LOGIC (FIXED) ---
    const executeTrade = async (isBuy) => {
        if (!userWallet || !selectedAsset) return;
        
        // 1. VALIDATE ASSET ID
        const assetIndex = assetMap[selectedAsset.symbol];
        if (assetIndex === undefined) {
            return showNotification(`Error: Could not find ID for ${selectedAsset.symbol}`, "error");
        }

        setIsTrading(true);

        try {
            // 2. Setup SDK
            const walletClient = createWalletClient({
                account: userWallet.address,
                chain: arbitrum,
                transport: custom(window.ethereum)
            });

            const transport = new HttpTransport(); // Mainnet
            const client = new ExchangeClient({ wallet: walletClient, transport });
            const info = new InfoClient({ transport });

            // 3. Get Fresh Price
            const allMids = await info.allMids();
            const price = parseFloat(allMids[selectedAsset.symbol]);
            
            // 4. Calculate Parameters
            const slippage = 0.05; // 5% buffer for Market Order
            const limitPx = isBuy ? price * (1 + slippage) : price * (1 - slippage);
            const sizeInTokens = parseFloat(usdSize) / price;

            // Rounding (Hyperliquid allows ~5 decimals mostly, using 4 is safe)
            const fmtSize = sizeInTokens.toFixed(4);
            const fmtPrice = limitPx.toFixed(4);

            console.log(`Placing Order: Asset #${assetIndex} (${selectedAsset.symbol}) Size: ${fmtSize}`);

            // 5. SEND ORDER
            const result = await client.order({
                orders: [{
                    a: assetIndex, // MUST BE INTEGER ID (e.g. 4), NOT STRING "ETH"
                    b: isBuy,
                    p: fmtPrice,
                    s: fmtSize,
                    r: false,
                    t: { limit: { tif: 'Ioc' } } // IOC = Market Order
                }],
                grouping: 'na'
            });

            // 6. Handle Response
            if (result.status === 'ok') {
                const status = result.response.data.statuses[0];
                if (status.filled) {
                    showNotification("Order Filled!", "success");
                    fetchPositions(userWallet.address);
                } else {
                    // Check if it's a specific error
                    const errorMsg = status.error || JSON.stringify(status);
                    showNotification(`Order Failed: ${errorMsg}`, "error");
                }
            } else {
                throw new Error(result.response?.data?.toString() || "Trade Failed");
            }

        } catch (error) {
            console.error(error);
            if (error.message?.includes("User rejected")) {
                showNotification("User rejected signature", "error");
            } else {
                showNotification("Trade Failed. Check Console.", "error");
            }
        } finally {
            setIsTrading(false);
        }
    };

    const closePosition = async (coin) => {
        if (!confirm("Close Position?")) return;
        
        const assetIndex = assetMap[coin];
        if (assetIndex === undefined) return alert("Asset ID not found");

        try {
            const walletClient = createWalletClient({
                account: userWallet.address,
                chain: arbitrum,
                transport: custom(window.ethereum)
            });
            const client = new ExchangeClient({ wallet: walletClient, transport: new HttpTransport() });
            const info = new InfoClient({ transport: new HttpTransport() });

            // Get Position Size
            const pos = positions.find(p => p.coin === coin);
            if(!pos) return;

            const isBuy = pos.side === 'SHORT'; // Close Short = Buy
            const size = Math.abs(parseFloat(pos.size));
            
            // Get Price
            const allMids = await info.allMids();
            const price = parseFloat(allMids[coin]);
            const limitPx = isBuy ? price * 1.05 : price * 0.95;

            await client.order({
                orders: [{
                    a: assetIndex,
                    b: isBuy,
                    p: limitPx.toFixed(4),
                    s: size.toFixed(4),
                    r: true, // Reduce Only
                    t: { limit: { tif: 'Ioc' } }
                }],
                grouping: 'na'
            });
            
            showNotification("Closed Successfully", "success");
            fetchPositions(userWallet.address);
        } catch(e) {
            console.error(e);
            showNotification("Failed to close", "error");
        }
    };

    const showNotification = (msg, type) => {
        setNotification({ message: msg, type });
        setTimeout(() => setNotification(null), 5000);
    };

    // --- DEPOSIT ---
    const handleDeposit = async () => {
        if (!depositAmount || parseFloat(depositAmount) < 10) return alert("Min 10 USDC");
        setIsDepositing(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const usdc = new Contract(ARBITRUM_USDC, USDC_ABI, signer);
            const tx = await usdc.transfer(HYPERLIQUID_BRIDGE, ethers.parseUnits(depositAmount, 6));
            await tx.wait();
            showNotification("Deposit Sent! Wait ~2 mins.", "success");
            setIsDepositing(false);
            setShowDepositModal(false);
        } catch (e) {
            console.error(e);
            setIsDepositing(false);
            alert("Deposit Failed");
        }
    };

    const filteredAssets = assets.filter(a => a.symbol.toLowerCase().includes(searchFilter.toLowerCase()));

    return (
        <div className="min-h-screen bg-black text-white font-mono flex flex-col">
            <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center sticky top-0 bg-black z-50">
                <div className="text-2xl font-black">X/<span className="text-gray-500">CHANGE</span></div>
                <div className="flex gap-4 items-center">
                    {userWallet ? (
                        <>
                            <button onClick={() => setShowDepositModal(true)} className="px-3 py-2 bg-gray-900 border border-gray-800 hover:border-blue-500 text-xs font-bold flex gap-2"><Wallet size={12} /> DEPOSIT</button>
                            {accountValue && <div className="text-right hidden md:block"><div className="text-[10px] text-gray-500">EQUITY</div><div className="font-bold">${accountValue.total_value?.toFixed(2)}</div></div>}
                            <div className="px-3 py-2 bg-gray-900 border border-gray-800 text-xs font-bold flex gap-2 items-center"><div className="w-2 h-2 rounded-full bg-green-500"></div>{userWallet.address.slice(0, 6)}...</div>
                        </>
                    ) : (
                        <button onClick={connectWallet} className="px-6 py-2 bg-white text-black font-bold text-xs hover:bg-gray-200">CONNECT WALLET</button>
                    )}
                </div>
            </header>

            {notification && <div className={`fixed top-20 right-6 z-50 p-4 border flex gap-3 ${notification.type === 'error' ? 'bg-red-900/20 text-red-500' : 'bg-green-900/20 text-green-500'}`}>{notification.message}</div>}

            <div className="flex flex-1 overflow-hidden">
                {!userWallet ? (
                    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><Wallet size={64} className="text-gray-700 mb-6" /><h2 className="text-3xl font-black mb-4">Connect to Trade</h2><button onClick={connectWallet} className="px-8 py-3 bg-white text-black font-bold text-lg hover:bg-gray-200">Connect Wallet</button></div>
                ) : showDepositModal ? (
                    <div className="flex flex-1 items-center justify-center bg-black/90 p-8">
                        <div className="bg-gray-900 p-8 rounded border border-gray-800 w-96">
                            <h2 className="text-xl font-bold mb-4">Deposit USDC</h2>
                            <input type="number" placeholder="Amount" value={depositAmount} onChange={e=>setDepositAmount(e.target.value)} className="w-full bg-black border border-gray-700 p-3 text-white mb-4" />
                            <button onClick={handleDeposit} disabled={isDepositing} className="w-full bg-blue-600 py-3 font-bold">{isDepositing ? "Processing..." : "Send Deposit"}</button>
                            <button onClick={() => setShowDepositModal(false)} className="w-full mt-2 text-xs text-gray-500">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="w-64 border-r border-gray-800 flex flex-col hidden lg:flex">
                            <div className="p-3 border-b border-gray-800 relative"><Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-600" size={14} /><input className="w-full bg-gray-900 border border-gray-700 py-1 pl-8 pr-2 text-xs text-white focus:outline-none" placeholder="Search..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} /></div>
                            <div className="flex-1 overflow-y-auto">{filteredAssets.map(asset => (<button key={asset.symbol} onClick={() => setSelectedAsset(asset)} className={`w-full px-4 py-3 flex justify-between items-center border-b border-gray-900 hover:bg-gray-900/50 ${selectedAsset?.symbol === asset.symbol ? 'bg-gray-900 border-l-2 border-l-white' : ''}`}><div className="text-left"><div className="font-bold text-sm">{asset.symbol}</div><div className="text-[10px] text-gray-500">PERP</div></div><div className="font-mono text-sm">${asset.price.toFixed(asset.price < 1 ? 4 : 2)}</div></button>))}</div>
                        </div>
                        
                        <div className="flex-1 flex flex-col bg-black">
                            {selectedAsset && <div className="h-2/3 p-6 flex flex-col border-b border-gray-800"><div className="mb-4"><h2 className="text-3xl font-black">{selectedAsset.symbol}USD</h2><div className="text-xl font-mono text-gray-400">${selectedAsset.price}</div></div><div className="flex-1 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="time" hide /><YAxis domain={['auto', 'auto']} orientation="right" tick={{ fill: '#333', fontSize: 10 }} stroke="#333" /><Line type="stepAfter" dataKey="price" stroke="#fff" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer></div></div>}
                            <div className="flex-1 bg-black p-4 overflow-auto"><div className="flex justify-between items-center mb-4"><h3 className="text-sm font-bold text-gray-500">OPEN POSITIONS</h3><RefreshCw size={14} onClick={()=>fetchPositions(userWallet.address)} className="cursor-pointer hover:text-white" /></div><table className="w-full text-xs"><thead><tr className="text-gray-600 border-b border-gray-800"><th className="text-left py-2">ASSET</th><th className="text-right py-2">SIZE</th><th className="text-right py-2">ENTRY</th><th className="text-right py-2">PNL</th><th className="text-right py-2">ACTION</th></tr></thead><tbody>{positions.map((pos, i) => (<tr key={i} className="border-b border-gray-900"><td className="py-3 font-bold">{pos.coin}</td><td className={`py-3 text-right ${pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>{pos.size}</td><td className="py-3 text-right">${pos.entry_price.toFixed(2)}</td><td className={`py-3 text-right ${pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>${pos.unrealized_pnl.toFixed(2)}</td><td className="py-3 text-right"><button onClick={() => closePosition(pos.coin)} className="text-[10px] underline hover:text-white">CLOSE</button></td></tr>))}{positions.length === 0 && <tr><td colSpan="5" className="py-8 text-center text-gray-600">No open positions</td></tr>}</tbody></table></div>
                        </div>

                        <div className="w-80 border-l border-gray-800 p-6 flex flex-col gap-6 bg-black">
                            <div><label className="text-[10px] font-bold text-gray-500 block mb-2">SIZE (USD)</label><input type="number" value={usdSize} onChange={e => setUsdSize(e.target.value)} className="w-full bg-gray-900 border border-gray-700 p-3 text-lg font-bold text-white focus:outline-none" /></div>
                            <div><div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-gray-500">LEVERAGE</label><span className="text-xs font-bold">{leverage}x</span></div><input type="range" min="1" max="50" value={leverage} onChange={e => setLeverage(Number(e.target.value))} className="w-full accent-white" /></div>
                            <div className="mt-auto space-y-3">
                                <button onClick={() => executeTrade(true)} disabled={isTrading} className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-black font-black flex justify-center gap-2">{isTrading ? <Loader2 className="animate-spin" /> : <TrendingUp />} BUY / LONG</button>
                                <button onClick={() => executeTrade(false)} disabled={isTrading} className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-black font-black flex justify-center gap-2">{isTrading ? <Loader2 className="animate-spin" /> : <TrendingDown />} SELL / SHORT</button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default App;