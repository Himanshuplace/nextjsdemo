"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Activity, Power, Plus, Trash2, TrendingUp, TrendingDown, Zap, BarChart3 } from 'lucide-react';

type WSStatus = 'connected' | 'disconnected' | 'error';
type MessageType = 'sent' | 'received' | 'error' | 'success' | 'info';
type StreamingType = 'ltpinfo' | 'marketPicture' | 'login' | 'logout';
type RequestType = 'subscribe' | 'unsubscribe';
type ViewTab = 'controls' | 'ltp' | 'marketPicture';

// LocalStorage keys
const STORAGE_KEYS = {
  subscriptions: 'stockBroker_subscriptions',
  credentials: 'stockBroker_credentials',
  wasLoggedIn: 'stockBroker_wasLoggedIn'
};

interface Message {
  type: MessageType;
  content: string;
  timestamp: string;
}

interface SubscribedToken {
  token: string;
  type: StreamingType;
}

interface MarketData {
  symbol: string;
  ltp?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  [key: string]: any;
}

interface SavedCredentials {
  gscid: string;
  gcid: string;
  sessionId: string;
  deviceId: string;
}

export default function StockBrokerClient() {
  const [wsStatus, setWsStatus] = useState<WSStatus>('disconnected');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [subscribedTokens, setSubscribedTokens] = useState<SubscribedToken[]>([]);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [activeTab, setActiveTab] = useState<ViewTab>('controls');

  // Form states
  const [gscid, setGscid] = useState<string>('KS02');
  const [gcid, setGcid] = useState<string>('218');
  const [sessionId, setSessionId] = useState<string>('dummy-session');
  const [deviceId, setDeviceId] = useState<string>('dummy-device');
  const [newToken, setNewToken] = useState<string>('NSECM:2885');
  const [streamingType, setStreamingType] = useState<StreamingType>('ltpinfo');

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // For auto-resubscribe after login
  const pendingSubscriptionsRef = useRef<SubscribedToken[]>([]);

  const scrollToBottom = () => {
    if (autoScroll) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => scrollToBottom(), [messages, autoScroll]);

  const addMessage = (type: MessageType, content: string) => {
    setMessages(prev => [...prev, {
      type,
      content,
      timestamp: new Date().toLocaleTimeString()
    }]);
  };

  // Save subscriptions to localStorage
  const saveSubscriptions = (tokens: SubscribedToken[]) => {
    localStorage.setItem(STORAGE_KEYS.subscriptions, JSON.stringify(tokens));
  };

  // Save credentials
  const saveCredentials = () => {
    const creds: SavedCredentials = { gscid, gcid, sessionId, deviceId };
    localStorage.setItem(STORAGE_KEYS.credentials, JSON.stringify(creds));
  };

  // Load from localStorage on mount
  useEffect(() => {
    // Load credentials
    const savedCreds = localStorage.getItem(STORAGE_KEYS.credentials);
    if (savedCreds) {
      try {
        const creds: SavedCredentials = JSON.parse(savedCreds);
        setGscid(creds.gscid);
        setGcid(creds.gcid);
        setSessionId(creds.sessionId);
        setDeviceId(creds.deviceId);
      } catch (e) { /* ignore */ }
    }

    // Load subscriptions
    const savedSubs = localStorage.getItem(STORAGE_KEYS.subscriptions);
    if (savedSubs) {
      try {
        const tokens: SubscribedToken[] = JSON.parse(savedSubs);
        setSubscribedTokens(tokens);
        pendingSubscriptionsRef.current = tokens; // for auto-resubscribe
      } catch (e) { /* ignore */ }
    }

    // Auto-connect if previously logged in
    const wasLoggedIn = localStorage.getItem(STORAGE_KEYS.wasLoggedIn) === 'true';
    if (wasLoggedIn && savedCreds && savedSubs) {
      connectWebSocket();
    }
  }, []);

  // Save credentials whenever they change
  useEffect(() => {
    saveCredentials();
  }, [gscid, gcid, sessionId, deviceId]);

  // Save subscriptions whenever they change
  useEffect(() => {
    saveSubscriptions(subscribedTokens);
  }, [subscribedTokens]);

  // Update wasLoggedIn flag
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wasLoggedIn, isLoggedIn.toString());
  }, [isLoggedIn]);

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket('ws://192.168.208.63:9688/websocket');

      wsRef.current.onopen = () => {
        setWsStatus('connected');
        addMessage('success', 'WebSocket connected');

        // Auto-login if we have credentials and were previously logged in
        if (pendingSubscriptionsRef.current.length > 0 || localStorage.getItem(STORAGE_KEYS.wasLoggedIn) === 'true') {
          setTimeout(sendLogin, 500); // slight delay to ensure connection stability
        }
      };

      wsRef.current.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          addMessage('received', JSON.stringify(parsed, null, 2));

          // Detect successful login response
          if (parsed.response?.svcName === "Broadcast" && parsed.response?.streamingType === "login") {
            setIsLoggedIn(true);
            addMessage('success', 'Login successful – auto-resubscribing tokens...');

            // Auto-resubscribe all saved tokens
            if (pendingSubscriptionsRef.current.length > 0) {
              pendingSubscriptionsRef.current.forEach(sub => {
                const request = {
                  request: {
                    data: { symbols: [{ symbol: sub.token }] },
                    gscid,
                    gcid,
                    request_type: "subscribe" as RequestType,
                    streamingType: sub.type
                  }
                };
                wsRef.current?.send(JSON.stringify(request));
                addMessage('sent', `Auto-subscribe: ${sub.token} (${sub.type})`);
              });
            }
          }

          // Handle market data
          let marketInfo: any = null;
          let symbol: string | undefined = undefined;

          if (parsed.response?.data) {
            marketInfo = parsed.response.data;
            symbol = marketInfo.symbol;
          } else if (parsed.symbol) {
            marketInfo = parsed;
            symbol = parsed.symbol;
          }

          if (symbol) {
            const normalized: MarketData = {
              symbol,
              ltp: marketInfo.ltp ?? null,
              change: marketInfo.change ?? null,
              changePercent: marketInfo.p_change ?? marketInfo.changePercent ?? null,
              volume: marketInfo.tot_vol ?? marketInfo.volume ?? null,
              high: marketInfo.high ?? null,
              low: marketInfo.low ?? null,
              open: marketInfo.open ?? null,
              close: marketInfo.close ?? null,
              ...marketInfo,
            };

            setMarketData(prev => ({
              ...prev,
              [symbol]: normalized
            }));
          }
        } catch (e) {
          addMessage('received', event.data);
        }
      };

      wsRef.current.onerror = () => {
        addMessage('error', 'WebSocket error occurred');
        setWsStatus('error');
      };

      wsRef.current.onclose = () => {
        setWsStatus('disconnected');
        setIsLoggedIn(false);
        addMessage('info', 'WebSocket disconnected');
      };
    } catch (error) {
      addMessage('error', `Connection failed: ${(error as Error).message}`);
    }
  };

  const disconnectWebSocket = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsLoggedIn(false);
    setSubscribedTokens([]);
    setMarketData({});
    pendingSubscriptionsRef.current = [];

    // Clear persistence on manual disconnect
    localStorage.removeItem(STORAGE_KEYS.subscriptions);
    localStorage.removeItem(STORAGE_KEYS.wasLoggedIn);
  };

  const sendLogin = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addMessage('error', 'Not connected');
      return;
    }

    const loginRequest = {
      request: {
        response_format: "json",
        request_type: "subscribe" as RequestType,
        streamingType: "login" as StreamingType,
        data: { gscid, gcid, sessionId, deviceId, device_type: "0" }
      }
    };

    wsRef.current.send(JSON.stringify(loginRequest));
    addMessage('sent', JSON.stringify(loginRequest, null, 2));
    // Don't set isLoggedIn here — wait for server confirmation
  };

  const sendLogout = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const logoutRequest = {
      request: {
        response_format: "json",
        request_type: "unsubscribe" as RequestType,
        streamingType: "logout" as StreamingType,
        data: { gscid, gcid, sessionId, deviceId, device_type: "0" }
      }
    };

    wsRef.current.send(JSON.stringify(logoutRequest));
    addMessage('sent', JSON.stringify(logoutRequest, null, 2));
    setIsLoggedIn(false);
    setSubscribedTokens([]);
    setMarketData({});
    pendingSubscriptionsRef.current = [];
    localStorage.removeItem(STORAGE_KEYS.wasLoggedIn);
    localStorage.removeItem(STORAGE_KEYS.subscriptions);
  };

  const subscribeToken = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isLoggedIn) {
      addMessage('error', !isLoggedIn ? 'Please login first' : 'Not connected');
      return;
    }

    const tokens = newToken.split(',').map(t => t.trim()).filter(Boolean);

    tokens.forEach(token => {
      const request = {
        request: {
          data: { symbols: [{ symbol: token }] },
          gscid, gcid,
          request_type: "subscribe" as RequestType,
          streamingType: streamingType
        }
      };

      wsRef.current?.send(JSON.stringify(request));
      addMessage('sent', JSON.stringify(request, null, 2));
    });

    const newSubs = tokens.map(t => ({ token: t, type: streamingType }));
    setSubscribedTokens(prev => {
      const existing = new Set(prev.map(i => `${i.token}-${i.type}`));
      const filtered = newSubs.filter(i => !existing.has(`${i.token}-${i.type}`));
      const updated = [...prev, ...filtered];
      pendingSubscriptionsRef.current = updated;
      return updated;
    });

    setNewToken('');
  };

  const unsubscribeToken = (token: string, type: StreamingType) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const request = {
      request: {
        data: { symbols: [{ symbol: token }] },
        gscid, gcid,
        request_type: "unsubscribe" as RequestType,
        streamingType: type
      }
    };

    wsRef.current.send(JSON.stringify(request));
    addMessage('sent', JSON.stringify(request, null, 2));

    const updated = subscribedTokens.filter(i => !(i.token === token && i.type === type));
    setSubscribedTokens(updated);
    pendingSubscriptionsRef.current = updated;

    setMarketData(prev => {
      const copy = { ...prev };
      delete copy[token];
      return copy;
    });
  };

  const ltpTokens = subscribedTokens.filter(t => t.type === 'ltpinfo');
  const mpTokens = subscribedTokens.filter(t => t.type === 'marketPicture');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Market Data Terminal
            </h1>
            <p className="text-slate-400">Real-time WebSocket Trading Client</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'} animate-pulse`} />
            <span className="text-sm font-medium uppercase">{wsStatus}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('controls')}
            className={`px-6 py-3 rounded-md font-medium transition-all ${activeTab === 'controls' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Controls & Log
            </div>
          </button>
          <button
            onClick={() => setActiveTab('ltp')}
            className={`px-6 py-3 rounded-md font-medium transition-all ${activeTab === 'ltp' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'} ${ltpTokens.length === 0 ? 'opacity-50' : ''}`}
            disabled={ltpTokens.length === 0}
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              LTP Watch ({ltpTokens.length})
            </div>
          </button>
          <button
            onClick={() => setActiveTab('marketPicture')}
            className={`px-6 py-3 rounded-md font-medium transition-all ${activeTab === 'marketPicture' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'} ${mpTokens.length === 0 ? 'opacity-50' : ''}`}
            disabled={mpTokens.length === 0}
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Market Picture ({mpTokens.length})
            </div>
          </button>
        </div>

        {/* Rest of your UI remains exactly the same */}
        {activeTab === 'controls' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-6">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Power className="w-5 h-5 text-blue-400" /> Connection</h2>
                {wsStatus === 'disconnected' ? (
                  <button onClick={connectWebSocket} className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 py-3 rounded-lg font-semibold">
                    Connect
                  </button>
                ) : (
                  <button onClick={disconnectWebSocket} className="w-full bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 py-3 rounded-lg font-semibold">
                    Disconnect
                  </button>
                )}
              </div>

              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-purple-400" /> Session</h2>
                <div className="space-y-3">
                  {['GSCID', 'GCID', 'Session ID', 'Device ID'].map((label, i) => (
                    <div key={i}>
                      <label className="block text-sm text-slate-400 mb-1">{label}</label>
                      <input
                        type="text"
                        value={[gscid, gcid, sessionId, deviceId][i]}
                        onChange={(e) => [setGscid, setGcid, setSessionId, setDeviceId][i](e.target.value)}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <button onClick={sendLogin} disabled={wsStatus !== 'connected' || isLoggedIn} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 py-2 rounded-lg font-semibold">Login</button>
                    <button onClick={sendLogout} disabled={!isLoggedIn} className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 py-2 rounded-lg font-semibold">Logout</button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Zap className="w-5 h-5 text-yellow-400" /> Subscribe</h2>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="NSECM:2885, NSECM:1234"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <select
                    value={streamingType}
                    onChange={(e) => setStreamingType(e.target.value as StreamingType)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2"
                  >
                    <option value="ltpinfo">LTP Info</option>
                    <option value="marketPicture">Market Picture</option>
                  </select>
                  <button
                    onClick={subscribeToken}
                    disabled={!isLoggedIn || !newToken.trim()}
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Subscribe
                  </button>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xl font-semibold mb-4">Active Subscriptions</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {subscribedTokens.length === 0 ? (
                    <p className="text-slate-400 text-sm">None</p>
                  ) : (
                    subscribedTokens.map((item, i) => (
                      <div key={i} className="bg-slate-700 rounded-lg p-3 flex justify-between items-center">
                        <div>
                          <p className="font-mono text-sm">{item.token}</p>
                          <p className="text-xs text-slate-400">{item.type}</p>
                        </div>
                        <button onClick={() => unsubscribeToken(item.token, item.type)} className="text-red-400 hover:text-red-300">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 bg-slate-800 rounded-xl p-6 border border-slate-700">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Activity Log</h2>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded" />
                    Auto-scroll
                  </label>
                  <button onClick={() => setMessages([])} className="text-sm text-slate-400 hover:text-white">Clear</button>
                </div>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-xs">
                {messages.length === 0 ? (
                  <p className="text-slate-500">No messages yet...</p>
                ) : (
                  messages.map((msg, i) => (
                    <div key={i} className="mb-3 pb-3 border-b border-slate-800 last:border-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-slate-500">{msg.timestamp}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          msg.type === 'sent' ? 'bg-blue-900 text-blue-200' :
                          msg.type === 'received' ? 'bg-green-900 text-green-200' :
                          msg.type === 'error' ? 'bg-red-900 text-red-200' :
                          msg.type === 'success' ? 'bg-emerald-900 text-emerald-200' :
                          'bg-slate-700 text-slate-300'
                        }`}>
                          {msg.type.toUpperCase()}
                        </span>
                      </div>
                      <pre className="text-slate-300 whitespace-pre-wrap break-words">{msg.content}</pre>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* LTP Watch Tab */}
        {activeTab === 'ltp' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 border-b border-slate-600">
              <h2 className="text-xl font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-cyan-400" /> LTP Watch</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/80 sticky top-0">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-bold uppercase tracking-wider">Symbol</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">LTP</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Change</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Change %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {ltpTokens.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-slate-500">No LTP subscriptions</td></tr>
                  ) : ltpTokens.map((item) => {
                    const data = marketData[item.token] || {};
                    const change = data.change || 0;
                    const isPositive = change >= 0;

                    return (
                      <tr key={item.token} className="hover:bg-slate-700/40 transition-colors">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-1.5 h-10 rounded-full ${isPositive ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div className="font-mono font-bold">{item.token}</div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-xl font-bold">
                          {data.ltp ? `₹${data.ltp.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-6 py-5 text-right font-bold text-base">
                          <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
                            {data.change ? `${isPositive ? '+' : ''}${data.change.toFixed(2)}` : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {data.changePercent != null ? (
                              <>
                                {isPositive ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
                                <span className={`font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                  {`${isPositive ? '+' : ''}${data.changePercent.toFixed(2)}%`}
                                </span>
                              </>
                            ) : '-'}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Market Picture Tab */}
        {activeTab === 'marketPicture' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 border-b border-slate-600">
              <h2 className="text-xl font-semibold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-cyan-400" /> Market Picture (Full Depth)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/80 sticky top-0">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-bold uppercase tracking-wider">Symbol</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">LTP</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Change</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Change %</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Volume</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">High</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Low</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Open</th>
                    <th className="px-6 py-4 text-right text-sm font-bold uppercase tracking-wider">Close</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {mpTokens.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-500">No Market Picture subscriptions</td></tr>
                  ) : mpTokens.map((item) => {
                    const data = marketData[item.token] || {};
                    const change = data.change || 0;
                    const isPositive = change >= 0;

                    return (
                      <tr key={item.token} className="hover:bg-slate-700/40 transition-colors">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className={`w-1.5 h-10 rounded-full ${isPositive ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div className="font-mono font-bold">{item.token}</div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-xl font-bold">{data.ltp ? `₹${data.ltp.toFixed(2)}` : '-'}</td>
                        <td className="px-6 py-5 text-right font-bold"><span className={isPositive ? 'text-green-400' : 'text-red-400'}>
                          {data.change ? `${isPositive ? '+' : ''}${data.change.toFixed(2)}` : '-'}
                        </span></td>
                        <td className="px-6 py-5 text-right">
                          {data.changePercent != null ? (
                            <div className="flex items-center justify-end gap-2">
                              {isPositive ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
                              <span className={`font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                {`${isPositive ? '+' : ''}${data.changePercent.toFixed(2)}%`}
                              </span>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-6 py-5 text-right">{data.volume ? data.volume.toLocaleString() : '-'}</td>
                        <td className="px-6 py-5 text-right">{data.high ? `₹${data.high.toFixed(2)}` : '-'}</td>
                        <td className="px-6 py-5 text-right">{data.low ? `₹${data.low.toFixed(2)}` : '-'}</td>
                        <td className="px-6 py-5 text-right">{data.open ? `₹${data.open.toFixed(2)}` : '-'}</td>
                        <td className="px-6 py-5 text-right">{data.close ? `₹${data.close.toFixed(2)}` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}