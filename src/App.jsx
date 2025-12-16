import React, { useState, useEffect } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import axios from 'axios';
import {
    TrendingUp, TrendingDown, Search, CheckCircle,
    AlertCircle, RefreshCw, Wallet, Loader2, Shield
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'https://x-backend-production-c71b.up.railway.app';
const HYPERLIQUID_API = 'https://api.hyperliquid.xyz';
const ARBITRUM_CHAIN_ID = '0xa4b1';
const HYPERLIQUID_BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

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
    const [agentApproved, setAgentApproved] = useState(false);
    const [isApprovingAgent, setIsApprovingAgent] = useState(false);

    const [depositAmount, setDepositAmount] = useState("");
    const [isDepositing, setIsDepositing] = useState(false);
    const [depositMessage, setDepositMessage] = useState("");
    const [showDepositModal, setShowDepositModal] = useState(false);

    const [notification, setNotification] = useState(null);
    const [chartData, setChartData] = useState([]);
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState(null);
    const [isLoadingPositions, setIsLoadingPositions] = useState(false);

    useEffect(() => {
        fetchMarkets();
    }, []);

    const fetchMarkets = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/markets`);
            setAssets(response.data);
            if (response.data.length > 0 && !selectedAsset) {
                setSelectedAsset(response.data[0]);
            }
        } catch (error) {
            console.error('Failed to fetch markets:', error);
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
        if (!window.ethereum) {
            alert('Please install MetaMask or Rabby wallet');
            return;
        }

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
                    alert("Please switch to Arbitrum One network");
                    return;
                }
            }

            console.log("✓ Connected:", address);
            setUserWallet({ address, signer, provider });
            checkAccountStatus(address);
            await generateAgentAddress(address);
        } catch (error) {
            console.error('Connection error:', error);
            showNotification('Failed to connect wallet', 'error');
        }
    };

    const generateAgentAddress = async (userAddress) => {
        try {
            const response = await axios.post(`${API_BASE_URL}/generate-agent`, {
                user_address: userAddress
            });
            setAgentAddress(response.data.agentAddress);
            console.log("Agent address:", response.data.agentAddress);
        } catch (error) {
            console.error("Failed to generate agent:", error);
        }
    };

    const checkAccountStatus = async (address) => {
        setIsCheckingStatus(true);
        try {
            const response = await axios.post(`${API_BASE_URL}/api/account-status`, {
                wallet_address: address
            });
            setAccountStatus(response.data);
            
            if (response.data.exists) {
                fetchPositions(address);
                const interval = setInterval(() => fetchPositions(address), 5000);
                return () => clearInterval(interval);
            } else {
                setShowDepositModal(true);
            }
        } catch (error) {
            console.error('Status check error:', error);
        } finally {
            setIsCheckingStatus(false);
        }
    };

    const handleDeposit = async () => {
        if (!depositAmount || parseFloat(depositAmount) < 10) {
            alert("Minimum deposit: 10 USDC");
            return;
        }

        setIsDepositing(true);
        setDepositMessage("Preparing transaction...");

        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const usdcContract = new Contract(ARBITRUM_USDC, USDC_ABI, signer);
            
            const decimals = await usdcContract.decimals();
            const amount = ethers.parseUnits(depositAmount, decimals);
            
            setDepositMessage("Please approve in wallet...");
            const tx = await usdcContract.transfer(HYPERLIQUID_BRIDGE, amount);
            
            setDepositMessage("Processing deposit...");
            await tx.wait();
            
            setDepositMessage("✓ Deposit confirmed!");
            setTimeout(() => {
                setShowDepositModal(false);
                checkAccountStatus(userWallet.address);
                setDepositMessage("");
            }, 2000);
        } catch (error) {
            console.error('Deposit error:', error);
            setDepositMessage("Deposit failed. Please try again.");
            setTimeout(() => setDepositMessage(""), 3000);
        } finally {
            setIsDepositing(false);
        }
    };

    const activateAgent = async () => {
        if (!userWallet || !agentAddress) {
            showNotification("Wallet not ready", "error");
            return;
        }

        setIsApprovingAgent(true);
        
        try {
            const nonce = Date.now();
            
            console.log("Requesting agent approval signature...");
            console.log("Agent address:", agentAddress);

            // EIP-712 typed data for Hyperliquid agent approval
            const typedData = {
                types: {
                    EIP712Domain: [
                        { name: "name", type: "string" },
                        { name: "version", type: "string" },
                        { name: "chainId", type: "uint256" },
                        { name: "verifyingContract", type: "address" }
                    ],
                    "HyperliquidTransaction:ApproveAgent": [
                        { name: "hyperliquidChain", type: "string" },
                        { name: "agentAddress", type: "string" },
                        { name: "agentName", type: "string" },
                        { name: "nonce", type: "uint64" }
                    ]
                },
                primaryType: "HyperliquidTransaction:ApproveAgent",
                domain: {
                    name: "HyperliquidSignTransaction",
                    version: "1",
                    chainId: "0x66eee", // Hyperliquid chainId (421614)
                    verifyingContract: "0x0000000000000000000000000000000000000000"
                },
                message: {
                    hyperliquidChain: "Mainnet",
                    agentAddress: agentAddress.toLowerCase(),
                    agentName: "X/CHANGE Agent",
                    nonce: nonce
                }
            };

            // Sign with eth_signTypedData_v4 (bypasses MetaMask chainId check)
            const signature = await window.ethereum.request({
                method: "eth_signTypedData_v4",
                params: [userWallet.address, JSON.stringify(typedData)]
            });

            console.log("Signature obtained, submitting to Hyperliquid...");

            // Parse signature
            const sig = ethers.Signature.from(signature);

            // Submit to Hyperliquid API
            const response = await fetch(`${HYPERLIQUID_API}/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: {
                        type: "approveAgent",
                        hyperliquidChain: "Mainnet",
                        signatureChainId: "0xa4b1", // Arbitrum (where user is connected)
                        agentAddress: agentAddress.toLowerCase(),
                        agentName: "X/CHANGE Agent",
                        nonce: nonce
                    },
                    nonce: nonce,
                    signature: {
                        r: sig.r,
                        s: sig.s,
                        v: sig.v
                    }
                })
            });

            const result = await response.json();
            console.log("Hyperliquid response:", result);

            if (result.status === "ok") {
                setAgentApproved(true);
                showNotification("✓ Trading Agent Activated!", "success");
            } else {
                throw new Error(result.response || "Agent approval failed");
            }
        } catch (error) {
            console.error("Agent activation error:", error);
            const errorMsg = error.message || error.toString();
            showNotification(`Activation failed: ${errorMsg}`, "error");
        } finally {
            setIsApprovingAgent(false);
        }
    };

    const executeTrade = async (isBuy) => {
        if (!userWallet || !selectedAsset) {
            showNotification("Please select an asset", "error");
            return;
        }
        
        if (!agentApproved) {
            showNotification("Please activate your trading agent first", "error");
            return;
        }
        
        setIsTrading(true);
        
        try {
            const response = await axios.post(`${API_BASE_URL}/trade`, {
                user_address: userWallet.address,
                coin: selectedAsset.symbol,
                is_buy: isBuy,
                usd_size: parseFloat(usdSize),
                leverage: leverage
            });
            
            showNotification(`✓ ${isBuy ? 'Long' : 'Short'} opened!`, "success");
            fetchPositions(userWallet.address);
        } catch (error) {
            console.error("Trade error:", error);
            const errorMsg = error.response?.data?.detail || error.message;
            
            if (errorMsg.toLowerCase().includes("agent") || 
                errorMsg.toLowerCase().includes("not approved")) {
                setAgentApproved(false);
                showNotification("Agent needs activation", "error");
            } else {
                showNotification(`Trade failed: ${errorMsg}`, "error");
            }
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
            console.error('Failed to fetch positions:', e);
        } finally {
            setIsLoadingPositions(false);
        }
    };
    
    const closePosition = async (coin) => {
        if (!window.confirm(`Close ${coin} position?`)) return;
        
        try {
            await axios.post(`${API_BASE_URL}/close-position`, {
                user_address: userWallet.address,
                coin
            });
            showNotification("Position closed", "success");
            fetchPositions(userWallet.address);
        } catch (e) {
            const errorMsg = e.response?.data?.detail || "Failed to close position";
            showNotification(errorMsg, "error");
        }
    };

    const showNotification = (msg, type) => {
        setNotification({ message: msg, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const filteredAssets = assets.filter(a =>
        a.symbol.toLowerCase().includes(searchFilter.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-black text-white font-mono flex flex-col">
            {/* Header */}
            <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-black/95 sticky top-0 z-50">
                <div className="text-2xl font-black tracking-tighter">
                    X/<span className="text-gray-500">CHANGE</span>
                </div>
                <div className="flex gap-4 items-center">
                    {userWallet ? (
                        <div className="flex gap-3 items-center">
                            <button
                                onClick={() => setShowDepositModal(true)}
                                className="px-3 py-2 bg-gray-900 border border-gray-800 hover:border-blue-500 text-xs font-bold flex gap-2 items-center"
                            >
                                <Wallet size={12} /> DEPOSIT
                            </button>
                            
                            {!agentApproved && (
                                <button
                                    onClick={activateAgent}
                                    disabled={isApprovingAgent}
                                    className="px-4 py-2 bg-yellow-500 text-black font-bold text-xs hover:bg-yellow-400 disabled:opacity-50 flex gap-2 items-center"
                                >
                                    <Shield size={14} />
                                    {isApprovingAgent ? "ACTIVATING..." : "ACTIVATE AGENT"}
                                </button>
                            )}
                            
                            {agentApproved && (
                                <div className="px-3 py-1 bg-green-900/20 border border-green-500/50 text-green-500 text-xs font-bold flex gap-2 items-center rounded">
                                    <CheckCircle size={12} /> AGENT ACTIVE
                                </div>
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
                        <button
                            onClick={connectWallet}
                            className="px-6 py-2 bg-white text-black font-bold text-xs hover:bg-gray-200"
                        >
                            CONNECT WALLET
                        </button>
                    )}
                </div>
            </header>

            {/* Notification */}
            {notification && (
                <div className={`fixed top-20 right-6 z-50 p-4 border flex items-center gap-3 rounded shadow-lg ${
                    notification.type === 'error'
                        ? 'bg-red-900/90 border-red-500 text-red-100'
                        : 'bg-green-900/90 border-green-500 text-green-100'
                }`}>
                    {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                    <span className="text-sm font-bold">{notification.message}</span>
                </div>
            )}

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {!userWallet ? (
                    // Not connected
                    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                        <Wallet size={64} className="text-gray-700 mb-6" />
                        <h2 className="text-3xl font-black mb-4">Connect to Trade</h2>
                        <p className="text-gray-500 mb-8">Connect your wallet to start trading perpetuals</p>
                        <button
                            onClick={connectWallet}
                            className="px-8 py-3 bg-white text-black font-bold text-lg hover:bg-gray-200"
                        >
                            Connect Wallet
                        </button>
                    </div>
                ) : isCheckingStatus ? (
                    // Checking status
                    <div className="flex flex-1 flex-col items-center justify-center">
                        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                        <p className="text-gray-500">Checking account status...</p>
                    </div>
                ) : showDepositModal ? (
                    // Deposit modal
                    <div className="flex flex-1 flex-col items-center justify-center p-8 bg-black">
                        <div className="max-w-md w-full bg-gray-900/50 border border-gray-800 p-8 rounded-xl backdrop-blur-sm">
                            <div className="text-center mb-8">
                                <h2 className="text-2xl font-bold">Deposit Funds</h2>
                                <p className="text-sm text-gray-500 mt-2">Bridge USDC from Arbitrum to Hyperliquid</p>
                            </div>
                            <div className="space-y-4">
                                <div className="relative">
                                    <input
                                        type="number"
                                        placeholder="Minimum 10.0"
                                        value={depositAmount}
                                        onChange={(e) => setDepositAmount(e.target.value)}
                                        className="w-full bg-black border border-gray-700 p-4 rounded text-white font-mono"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold">
                                        USDC
                                    </span>
                                </div>
                                <button
                                    onClick={handleDeposit}
                                    disabled={isDepositing}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded"
                                >
                                    {isDepositing ? "Processing..." : "Deposit"}
                                </button>
                                {depositMessage && (
                                    <div className="text-center text-blue-400 text-xs">{depositMessage}</div>
                                )}
                                {accountStatus?.exists && (
                                    <button
                                        onClick={() => setShowDepositModal(false)}
                                        className="w-full text-xs text-gray-500 mt-2 hover:text-white"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    // Main trading interface
                    <>
                        {/* Asset List */}
                        <div className="w-64 border-r border-gray-800 flex flex-col hidden lg:flex">
                            <div className="p-3 border-b border-gray-800 relative">
                                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-600" size={14} />
                                <input
                                    className="w-full bg-gray-900 border border-gray-700 py-1 pl-8 pr-2 text-xs text-white focus:outline-none"
                                    placeholder="Search markets..."
                                    value={searchFilter}
                                    onChange={e => setSearchFilter(e.target.value)}
                                />
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                {filteredAssets.map(asset => (
                                    <button
                                        key={asset.symbol}
                                        onClick={() => setSelectedAsset(asset)}
                                        className={`w-full px-4 py-3 flex justify-between items-center border-b border-gray-900 hover:bg-gray-900/50 ${
                                            selectedAsset?.symbol === asset.symbol
                                                ? 'bg-gray-900 border-l-2 border-l-white'
                                                : ''
                                        }`}
                                    >
                                        <div className="text-left">
                                            <div className="font-bold text-sm">{asset.symbol}</div>
                                            <div className="text-[10px] text-gray-500">PERP</div>
                                        </div>
                                        <div className="font-mono text-sm">
                                            ${asset.price.toFixed(asset.price < 1 ? 4 : 2)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Chart & Positions */}
                        <div className="flex-1 flex flex-col bg-black">
                            {/* Chart */}
                            {selectedAsset && (
                                <div className="h-2/3 p-6 flex flex-col border-b border-gray-800">
                                    <div className="mb-4">
                                        <h2 className="text-3xl font-black">{selectedAsset.symbol}USD</h2>
                                        <div className="text-xl font-mono text-gray-400">
                                            ${selectedAsset.price.toFixed(selectedAsset.price < 1 ? 4 : 2)}
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={chartData}>
                                                <XAxis dataKey="time" hide />
                                                <YAxis
                                                    domain={['auto', 'auto']}
                                                    orientation="right"
                                                    tick={{ fill: '#333', fontSize: 10 }}
                                                    stroke="#333"
                                                />
                                                <Line
                                                    type="stepAfter"
                                                    dataKey="price"
                                                    stroke="#fff"
                                                    strokeWidth={1}
                                                    dot={false}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            {/* Positions */}
                            <div className="flex-1 bg-black p-4 overflow-auto">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-gray-500">OPEN POSITIONS</h3>
                                    <RefreshCw
                                        size={14}
                                        className={`text-gray-600 cursor-pointer hover:text-white ${
                                            isLoadingPositions ? 'animate-spin' : ''
                                        }`}
                                        onClick={() => fetchPositions(userWallet.address)}
                                    />
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
                                            <tr key={i} className="border-b border-gray-900 hover:bg-gray-900/30">
                                                <td className="py-3 font-bold">{pos.coin}</td>
                                                <td
                                                    className={`py-3 text-right font-bold ${
                                                        pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'
                                                    }`}
                                                >
                                                    {pos.size > 0 ? '+' : ''}{pos.size.toFixed(4)}
                                                </td>
                                                <td className="py-3 text-right">${pos.entry_price.toFixed(2)}</td>
                                                <td
                                                    className={`py-3 text-right font-bold ${
                                                        pos.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                                                    }`}
                                                >
                                                    ${pos.unrealized_pnl.toFixed(2)}
                                                </td>
                                                <td className="py-3 text-right">
                                                    <button
                                                        onClick={() => closePosition(pos.coin)}
                                                        className="text-[10px] px-2 py-1 bg-red-900/20 border border-red-500/50 rounded hover:bg-red-900/40"
                                                    >
                                                        CLOSE
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {positions.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="py-8 text-center text-gray-600">
                                                    No open positions
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Trading Panel */}
                        <div className="w-80 border-l border-gray-800 p-6 flex flex-col gap-6 bg-black">
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-2">
                                    SIZE (USD)
                                </label>
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
                                    type="range"
                                    min="1"
                                    max="50"
                                    value={leverage}
                                    onChange={e => setLeverage(Number(e.target.value))}
                                    className="w-full accent-white"
                                />
                            </div>

                            {!agentApproved && (
                                <div className="p-4 bg-yellow-900/20 border border-yellow-500/50 rounded text-xs text-yellow-200">
                                    <p className="font-bold mb-2">⚠️ Trading Agent Required</p>
                                    <p>Click "Activate Agent" above to enable trading</p>
                                </div>
                            )}

                            <div className="mt-auto space-y-3">
                                <button
                                    onClick={() => executeTrade(true)}
                                    disabled={isTrading || !agentApproved}
                                    className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-black font-black flex justify-center items-center gap-2"
                                >
                                    {isTrading ? (
                                        <RefreshCw className="animate-spin" size={18} />
                                    ) : (
                                        <TrendingUp size={18} />
                                    )}
                                    BUY / LONG
                                </button>
                                <button
                                    onClick={() => executeTrade(false)}
                                    disabled={isTrading || !agentApproved}
                                    className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-black font-black flex justify-center items-center gap-2"
                                >
                                    {isTrading ? (
                                        <RefreshCw className="animate-spin" size={18} />
                                    ) : (
                                        <TrendingDown size={18} />
                                    )}
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