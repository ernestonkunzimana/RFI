import React, { useState, useEffect, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { 
  Activity, Shield, TrendingUp, Plus, Search, 
  ChevronRight, AlertCircle, CheckCircle2, Clock, 
  LayoutDashboard, List, BarChart3, Settings, LogIn, LogOut,
  Zap, Bell, Database, Video, Download, Loader2,
  Trophy, Users, ShieldAlert, ShieldCheck, Play, Scale as ScaleIcon,
  Eye, Target, Info, Cpu, MessageSquare, Image as ImageIcon,
  MapPin, Globe, Sparkles, Send, Trash2, Maximize2
} from 'lucide-react';
import { 
  analyzeVideo, analyzeImage, chatWithGemini, 
  generateImage, generateVideo, searchGrounding, 
  mapsGrounding, fastResponse 
} from './services/geminiService';
import { 
  collection, addDoc, onSnapshot, query, orderBy, limit, 
  Timestamp, serverTimestamp, updateDoc, doc, getDoc
} from 'firebase/firestore';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { io, Socket } from 'socket.io-client';
import { db, auth } from './firebase';
import { cn } from './lib/utils';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Team {
  id: string;
  name: string;
  location?: string;
}

interface Player {
  id: string;
  name: string;
  teamId: string;
  status: 'active' | 'suspended' | 'retired';
}

interface Match {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  date: any;
  status: 'pending' | 'live' | 'completed';
  homeScore: number;
  awayScore: number;
}

interface MatchEvent {
  id: string;
  matchId: string;
  playerId?: string;
  type: 'goal' | 'yellow_card' | 'red_card' | 'foul' | 'substitution';
  minute: number;
  timestamp: string;
}

interface VARDecision {
  id: string;
  matchId: string;
  eventId: string;
  initialDecision: string;
  finalDecision: string;
  confidenceScore: number;
  reviewer: string;
  timestamp: string;
}

interface DisciplineRecord {
  id: string;
  playerId: string;
  yellowCards: number;
  redCards: number;
  suspended: boolean;
}

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  timestamp: string;
  userId: string;
}

// --- Components ---

const StatCard = ({ title, value, icon: Icon, trend, color }: any) => (
  <div className="bg-[#151619] border border-[#2A2B2F] p-5 rounded-xl flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <div className={cn("p-2 rounded-lg", color)}>
        <Icon size={20} className="text-white" />
      </div>
      {trend && (
        <span className={cn("text-xs font-medium", trend > 0 ? "text-green-400" : "text-red-400")}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <div>
      <p className="text-[#8E9299] text-xs uppercase tracking-wider font-semibold">{title}</p>
      <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
    </div>
  </div>
);

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We'll show a toast or alert in a real app, but for now log it
  return errInfo;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [discipline, setDiscipline] = useState<DisciplineRecord[]>([]);
  const [decisions, setDecisions] = useState<VARDecision[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'matches' | 'discipline' | 'rankings' | 'dataset' | 'decisions' | 'audit' | 'intelligence'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any | null>(null);
  const [lastUpdate, setLastUpdate] = useState<any>(null);
  const [clipStatus, setClipStatus] = useState<Record<string, 'idle' | 'processing' | 'ready'>>({});
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [eventFormMatch, setEventFormMatch] = useState<Match | null>(null);
  const [eventFormPlayerId, setEventFormPlayerId] = useState<string>('');
  const [eventFormType, setEventFormType] = useState<MatchEvent['type']>('goal');
  const [eventFormMinute, setEventFormMinute] = useState<number>(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [videoAnalysisResult, setVideoAnalysisResult] = useState<string | null>(null);
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ text: string, sources: any[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [mapsQuery, setMapsQuery] = useState('');
  const [mapsResult, setMapsResult] = useState<{ text: string, sources: any[] } | null>(null);
  const [isMapping, setIsMapping] = useState(false);
  const [veoPrompt, setVeoPrompt] = useState('');
  const [veoResult, setVeoResult] = useState<string | null>(null);
  const [isGeneratingVeo, setIsGeneratingVeo] = useState(false);
  const [veoImage, setVeoImage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const addNotification = (notif: any) => {
    const id = Date.now();
    setNotifications(prev => [{ ...notif, id }, ...prev].slice(0, 5));
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 8000);
  };

  // --- Date Helper ---
  const safeDate = (date: any) => {
    if (!date) return new Date();
    if (typeof date.toDate === 'function') return date.toDate();
    const d = new Date(date);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  // Auth Listener
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkApiKey();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSelectApiKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success as per guidelines
    }
  };

  // Socket.io Listener
  useEffect(() => {
    if (!user) return;
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to RNFIDS Real-time Stream');
    });

    socket.on('score-update', (update: any) => {
      console.log('Real-time Score Update Received:', update);
      setLastUpdate(update);
      addNotification({
        type: 'score',
        title: 'GOAL RECORDED',
        message: `${update.scorer} scored! ${update.score.home}-${update.score.away}`,
        icon: Trophy,
        color: 'text-green-400'
      });
      
      setMatches(prev => prev.map(m => 
        m.id === update.matchId ? { ...m, homeScore: update.score.home, awayScore: update.score.away, status: 'live' } : m
      ));

      setTimeout(() => setLastUpdate(null), 5000);
    });

    socket.on('discipline-update', (data: any) => {
      console.log('Discipline Update:', data);
      const player = players.find(p => p.id === data.playerId);
      const playerName = player ? player.name : data.playerId;
      const message = data.message.replace(data.playerId, playerName);
      
      addNotification({
        type: 'discipline',
        title: data.suspended ? 'PLAYER SUSPENDED' : 'DISCIPLINE ALERT',
        message,
        icon: data.suspended ? ShieldAlert : AlertCircle,
        color: data.suspended ? 'text-red-500' : 'text-yellow-400'
      });
    });

    socket.on('clip-ready', (data: { eventId: string, clipUrl: string }) => {
      console.log('Clip Ready:', data);
      setClipStatus(prev => ({ ...prev, [data.eventId]: 'ready' }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user) return;

    const unsubMatches = onSnapshot(collection(db, 'matches'), (snap) => {
      setMatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Match)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'matches'));

    const unsubPlayers = onSnapshot(collection(db, 'players'), (snap) => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Player)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'players'));

    const unsubTeams = onSnapshot(collection(db, 'teams'), (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() } as Team)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'teams'));

    const unsubDiscipline = onSnapshot(collection(db, 'discipline'), (snap) => {
      setDiscipline(snap.docs.map(d => ({ id: d.id, ...d.data() } as DisciplineRecord)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'discipline'));

    const unsubDecisions = onSnapshot(collection(db, 'decisions'), (snap) => {
      setDecisions(snap.docs.map(d => ({ id: d.id, ...d.data() } as VARDecision)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'decisions'));

    return () => {
      unsubMatches();
      unsubPlayers();
      unsubTeams();
      unsubDiscipline();
      unsubDecisions();
    };
  }, [user]);

  const handleSeedData = async () => {
    if (!user) return;
    try {
      const team1 = await addDoc(collection(db, 'teams'), { name: "Rayon Sports", location: "Kigali" });
      const team2 = await addDoc(collection(db, 'teams'), { name: "APR FC", location: "Kigali" });
      
      const player1 = await addDoc(collection(db, 'players'), { name: "Yannick Mukunzi", teamId: team1.id, status: "active" });
      const player2 = await addDoc(collection(db, 'players'), { name: "Jacques Tuyisenge", teamId: team2.id, status: "active" });
      const player3 = await addDoc(collection(db, 'players'), { name: "Meddie Kagere", teamId: team1.id, status: "active" });

      await addDoc(collection(db, 'matches'), {
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        date: new Date().toISOString(),
        status: "live",
        homeScore: 1,
        awayScore: 0
      });

      await addDoc(collection(db, 'discipline'), {
        playerId: player1.id,
        yellowCards: 1,
        redCards: 0,
        suspended: false
      });
      
      alert("RNFIDS seeded with national-grade data.");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seed');
    }
  };

  const handleAddEvent = async (matchId: string, type: MatchEvent['type'], playerId?: string) => {
    if (!user) return;
    const match = matches.find(m => m.id === matchId);
    if (!match) return;

    try {
      const eventData = {
        matchId,
        playerId,
        type,
        minute: Math.floor(Math.random() * 90),
        timestamp: new Date().toISOString(),
        createdBy: user.uid
      };

      // 1. Update Score if Goal
      if (type === 'goal') {
        const isHome = match.homeTeamId === players.find(p => p.id === playerId)?.teamId;
        const update = isHome 
          ? { homeScore: match.homeScore + 1 } 
          : { awayScore: match.awayScore + 1 };
        
        await updateDoc(doc(db, 'matches', matchId), update);
        
        // Push real-time score
        await fetch(`/api/matches/${matchId}/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            home: isHome ? match.homeScore + 1 : match.homeScore,
            away: !isHome ? match.awayScore + 1 : match.awayScore,
            eventType: 'GOAL',
            scorer: players.find(p => p.id === playerId)?.name
          })
        });
      }

      // 2. Trigger Discipline Engine
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
      });

      alert(`Event ${type} recorded.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'events');
    }
  };

  const handleManualEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventFormMatch || !eventFormPlayerId) return;

    try {
      const eventData = {
        matchId: eventFormMatch.id,
        playerId: eventFormPlayerId,
        type: eventFormType,
        minute: eventFormMinute,
        timestamp: new Date().toISOString(),
        createdBy: user?.uid
      };

      // Update Score if Goal
      if (eventFormType === 'goal') {
        const isHome = eventFormMatch.homeTeamId === players.find(p => p.id === eventFormPlayerId)?.teamId;
        const update = isHome 
          ? { homeScore: eventFormMatch.homeScore + 1 } 
          : { awayScore: eventFormMatch.awayScore + 1 };
        
        await updateDoc(doc(db, 'matches', eventFormMatch.id), update);
      }

      // Trigger Discipline Engine / Save Event
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
      });

      alert(`Event ${eventFormType} recorded manually.`);
      setEventFormMatch(null);
      setEventFormPlayerId('');
      setEventFormMinute(0);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'events');
    }
  };

  const handleExportDataset = async () => {
    try {
      const response = await fetch('/api/dataset/export');
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rnfis_dataset_${format(safeDate(new Date()), 'yyyyMMdd_HHmm')}.json`;
      a.click();
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const handleGenerateClip = async (eventId: string) => {
    setClipStatus(prev => ({ ...prev, [eventId]: 'processing' }));
    try {
      await fetch('/api/video/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, startTime: 120, duration: 10 })
      });
    } catch (err) {
      console.error("Clip generation failed", err);
      setClipStatus(prev => ({ ...prev, [eventId]: 'idle' }));
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const newMessages = [...chatMessages, { role: 'user' as const, content: chatInput }];
    setChatMessages(newMessages);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await chatWithGemini(newMessages, "You are a football intelligence expert for the Rwanda National Football Intelligence & Discipline System (RNFIDS). You help officials analyze match data, player conduct, and system integrity.");
      if (response) {
        setChatMessages(prev => [...prev, { role: 'model', content: response }]);
      }
    } catch (err) {
      console.error("Chat failed", err);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleVideoAnalysis = async () => {
    setIsAnalyzingVideo(true);
    try {
      // For demo, we'll use a placeholder or the current video if we could get its base64
      // Since we can't easily get base64 from a remote video tag in the browser without CORS,
      // we'll simulate with a prompt for now, or use a sample base64 if available.
      const result = await analyzeVideo("placeholder", "Analyze this match clip for any potential disciplinary infractions or VAR-worthy incidents.");
      setVideoAnalysisResult(result);
    } catch (err) {
      console.error("Video analysis failed", err);
    } finally {
      setIsAnalyzingVideo(false);
    }
  };

  const handleImageGeneration = async () => {
    if (!imagePrompt.trim()) return;
    setIsGeneratingImage(true);
    try {
      const url = await generateImage(imagePrompt, aspectRatio, 'pro');
      setGeneratedImage(url);
    } catch (err) {
      console.error("Image generation failed", err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const result = await searchGrounding(searchQuery);
      setSearchResult(result);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapsSearch = async () => {
    if (!mapsQuery.trim()) return;
    setIsMapping(true);
    try {
      const result = await mapsGrounding(mapsQuery);
      setMapsResult(result);
    } catch (err) {
      console.error("Maps search failed", err);
    } finally {
      setIsMapping(false);
    }
  };

  const handleVeoGeneration = async () => {
    if (!veoPrompt.trim()) return;
    setIsGeneratingVeo(true);
    try {
      const url = await generateVideo(veoPrompt, veoImage || undefined);
      setVeoResult(url);
    } catch (err) {
      console.error("Veo generation failed", err);
    } finally {
      setIsGeneratingVeo(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  };

  // Mock Analytics Data for Charts
  const accuracyData = [
    { name: 'Jan', accuracy: 85 },
    { name: 'Feb', accuracy: 88 },
    { name: 'Mar', accuracy: 92 },
    { name: 'Apr', accuracy: 89 },
    { name: 'May', accuracy: 94 },
  ];

  const decisionTypes = [
    { name: 'Penalty', value: 40, color: '#F27D26' },
    { name: 'Offside', value: 30, color: '#3B82F6' },
    { name: 'Red Card', value: 15, color: '#EF4444' },
    { name: 'Goal', value: 15, color: '#10B981' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#F27D26]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white font-sans flex">
      {/* Notifications Overlay */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 w-80">
        <AnimatePresence>
          {notifications.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className="glass p-4 rounded-2xl shadow-2xl flex gap-4 items-start border-l-4 border-l-[#F27D26]"
            >
              <div className={cn("p-2 rounded-xl bg-[#0A0A0B]", notif.color)}>
                <notif.icon size={20} />
              </div>
              <div>
                <h4 className="font-black text-xs uppercase tracking-widest mb-1">{notif.title}</h4>
                <p className="text-xs text-[#8E9299] leading-relaxed">{notif.message}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sidebar */}
      <aside className="w-64 border-r border-[#1F2023] bg-[#0F1012] flex flex-col">
        <div className="p-6 border-b border-[#1F2023]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#F27D26] rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">RNFIDS</h1>
          </div>
          <p className="text-[10px] text-[#8E9299] uppercase tracking-[0.2em] mt-2 font-bold">National Intelligence</p>
        </div>

        <nav className="flex-1 p-4 flex flex-col gap-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'dashboard' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <LayoutDashboard size={18} />
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('matches')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'matches' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <Trophy size={18} />
            Matches
          </button>
          <button 
            onClick={() => setActiveTab('discipline')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'discipline' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <ShieldAlert size={18} />
            Discipline
          </button>
          <button 
            onClick={() => setActiveTab('rankings')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'rankings' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <Users size={18} />
            Rankings
          </button>
          <button 
            onClick={() => setActiveTab('decisions')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'decisions' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <ScaleIcon size={18} />
            VAR Decisions
          </button>
          <button 
            onClick={() => setActiveTab('dataset')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'dataset' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <Database size={18} />
            Dataset Builder
          </button>
          <button 
            onClick={() => setActiveTab('intelligence')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'intelligence' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <Zap size={18} />
            AI Intelligence
          </button>
          <button 
            onClick={() => setActiveTab('audit')}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
              activeTab === 'audit' ? "bg-[#F27D26] text-white shadow-lg shadow-[#F27D26]/20" : "text-[#8E9299] hover:bg-[#1F2023] hover:text-white"
            )}
          >
            <ShieldCheck size={18} />
            System Audit
          </button>
        </nav>

        <div className="p-4 border-t border-[#1F2023]">
          {user ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between bg-[#151619] p-3 rounded-xl border border-[#2A2B2F]">
                <div className="flex items-center gap-3">
                  <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-[#F27D26]" referrerPolicy="no-referrer" />
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold truncate">{user.displayName}</p>
                    <p className="text-[10px] text-[#F27D26] font-black uppercase tracking-tighter">Ministry Official</p>
                  </div>
                </div>
                <button onClick={handleLogout} className="text-[#8E9299] hover:text-red-400 transition-colors">
                  <LogOut size={16} />
                </button>
              </div>
              
              <div className="bg-[#1F2023]/50 rounded-2xl p-4 border border-[#2A2B2F]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">System Health</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span className="text-[#8E9299]">AI ENGINE</span>
                    <span className="text-green-400">OPTIMAL</span>
                  </div>
                  <div className="w-full bg-[#0A0A0B] h-1 rounded-full overflow-hidden">
                    <div className="bg-green-500 h-full w-[94%]"></div>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold">
                    <span className="text-[#8E9299]">FEED SYNC</span>
                    <span className="text-green-400">12ms</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-2 bg-white text-black px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
            >
              <LogIn size={18} />
              Login with Google
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#0A0A0B]">
        <header className="h-20 border-b border-[#2A2B2F] bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="flex items-center gap-6 flex-1">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-black uppercase tracking-tighter text-[#F27D26]">
              {activeTab === 'dashboard' ? 'Intelligence Feed' : 
               activeTab === 'matches' ? 'Match Management' : 
               activeTab === 'discipline' ? 'Discipline Registry' : 
               activeTab === 'rankings' ? 'National Rankings' : 
               activeTab === 'decisions' ? 'VAR Decisions' : 
               activeTab === 'audit' ? 'System Audit' : 
               activeTab === 'intelligence' ? 'AI Intelligence Hub' :
               'Dataset Builder'}
            </h2>
              <div className="h-6 w-[1px] bg-[#2A2B2F]"></div>
              <div className="flex items-center gap-2 text-[#8E9299] text-[10px] font-bold uppercase tracking-widest">
                <Clock size={12} />
                <span>LIVE SYNC: {format(safeDate(new Date()), 'HH:mm:ss')}</span>
              </div>
            </div>
            
            <div className="h-8 w-[1px] bg-[#2A2B2F]"></div>
            
            <div className="flex items-center gap-4 overflow-hidden flex-1 max-w-2xl">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <Zap size={14} className="text-[#F27D26] animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Intelligence Feed:</span>
              </div>
              <div className="flex gap-8 animate-marquee whitespace-nowrap">
                <span className="text-[10px] font-bold text-white/60">Goal recorded in Match #821 (Mukunzi 42')</span>
                <span className="text-[10px] font-bold text-white/60">VAR Review initiated at National Stadium</span>
                <span className="text-[10px] font-bold text-white/60">Player Suspension: Meddie Kagere (3Y accumulation)</span>
                <span className="text-[10px] font-bold text-white/60">System: AI Dataset Export Ready</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {lastUpdate && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 bg-[#F27D26] text-white px-4 py-2 rounded-xl shadow-lg shadow-[#F27D26]/40"
              >
                <Trophy size={18} className="fill-white" />
                <div className="text-xs">
                  <p className="font-black uppercase tracking-tighter">GOAL ALERT!</p>
                  <p className="font-bold opacity-90">{lastUpdate.score.home} - {lastUpdate.score.away}</p>
                </div>
              </motion.div>
            )}
            <div className="flex items-center gap-2">
              <button className="p-2.5 hover:bg-[#1F2023] rounded-xl transition-colors relative text-[#8E9299] hover:text-white border border-transparent hover:border-[#2A2B2F]">
                <Bell size={20} />
                <span className="absolute top-2 right-2 w-2 h-2 bg-[#F27D26] rounded-full border-2 border-[#0A0A0B]"></span>
              </button>
              <button className="p-2.5 hover:bg-[#1F2023] rounded-xl transition-colors text-[#8E9299] hover:text-white border border-transparent hover:border-[#2A2B2F]">
                <Settings size={20} />
              </button>
            </div>
            
            <div className="h-8 w-[1px] bg-[#2A2B2F]"></div>
            
            {user && (
              <button 
                onClick={handleSeedData}
                className="bg-[#1F2023] text-[#8E9299] hover:text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-[#2A2B2F] transition-all hover:border-[#F27D26] hover:bg-[#F27D26]/10"
              >
                Initialize Data
              </button>
            )}
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {activeTab === 'dashboard' && (
            <div className="flex flex-col gap-8">
              {/* National Intelligence Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Shield size={80} className="text-[#F27D26]" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[#F27D26]/10 flex items-center justify-center">
                        <Shield size={20} className="text-[#F27D26]" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-[#8E9299]">Integrity</h4>
                        <p className="text-2xl font-black">98.4%</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#8E9299] leading-relaxed">System-wide monitoring active.</p>
                  </div>
                </div>

                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Zap size={80} className="text-[#3B82F6]" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                        <Zap size={20} className="text-[#3B82F6]" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-[#8E9299]">AI Latency</h4>
                        <p className="text-2xl font-black">42ms</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#8E9299] leading-relaxed">Real-time VAR processing.</p>
                  </div>
                </div>

                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Users size={80} className="text-green-400" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <Users size={20} className="text-green-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-[#8E9299]">Scouts</h4>
                        <p className="text-2xl font-black">1,240</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#8E9299] leading-relaxed">National network connected.</p>
                  </div>
                </div>

                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <ShieldAlert size={80} className="text-red-400" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                        <ShieldAlert size={20} className="text-red-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-[#8E9299]">Alerts</h4>
                        <p className="text-2xl font-black">02</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#8E9299] leading-relaxed">Critical discipline flags.</p>
                  </div>
                </div>
              </div>

              {/* Video Analysis & Top Players */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-2xl">
                  <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between bg-[#1F2023]/30">
                    <h3 className="font-bold flex items-center gap-2">
                      <Video size={18} className="text-[#F27D26]" />
                      Intelligence Feed Analysis
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                      <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Live Stream</span>
                    </div>
                  </div>
                  <div className="aspect-video bg-black relative group">
                    <video 
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      src="https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                      controls
                    />
                    <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
                      <div className="bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">AI Surveillance Active</span>
                      </div>
                      <div className="bg-[#F27D26]/80 backdrop-blur-md px-3 py-1.5 rounded-lg flex items-center gap-2">
                        <Shield size={12} className="text-white" />
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Integrity Verified</span>
                      </div>
                      <button 
                        onClick={handleVideoAnalysis}
                        disabled={isAnalyzingVideo}
                        className="bg-blue-600/80 backdrop-blur-md px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {isAnalyzingVideo ? <Loader2 size={12} className="animate-spin text-white" /> : <Cpu size={12} className="text-white" />}
                        <span className="text-[10px] font-black text-white uppercase tracking-widest">Analyze with Gemini</span>
                      </button>
                    </div>
                    {videoAnalysisResult && (
                      <div className="absolute bottom-4 left-4 right-4 z-30 bg-black/80 backdrop-blur-xl border border-white/10 p-4 rounded-xl max-h-40 overflow-y-auto scrollbar-hide">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Sparkles size={14} className="text-[#F27D26]" />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Gemini Analysis</span>
                          </div>
                          <button onClick={() => setVideoAnalysisResult(null)} className="text-white/40 hover:text-white">
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed">{videoAnalysisResult}</p>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <Play size={48} className="text-white/50" />
                    </div>
                  </div>
                  <div className="p-4 bg-[#0F1012] border-t border-[#2A2B2F]">
                    <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mb-3">Recent Events</p>
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                      {[
                        { time: 10, label: 'Kickoff', type: 'info' },
                        { time: 45, label: 'Foul - Yellow Card', type: 'warning' },
                        { time: 120, label: 'Goal - Rayon Sports', type: 'success' },
                        { time: 240, label: 'VAR Review', type: 'danger' },
                        { time: 310, label: 'Substitution', type: 'info' },
                      ].map((evt, i) => (
                        <button 
                          key={i}
                          onClick={() => seekTo(evt.time)}
                          className={cn(
                            "flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition-all hover:scale-105",
                            evt.type === 'info' ? "bg-blue-500/10 border-blue-500/20 text-blue-400" :
                            evt.type === 'warning' ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                            evt.type === 'success' ? "bg-green-500/10 border-green-500/20 text-green-400" :
                            "bg-red-500/10 border-red-500/20 text-red-400"
                          )}
                        >
                          {evt.label} ({Math.floor(evt.time / 60)}:{(evt.time % 60).toString().padStart(2, '0')})
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between bg-[#1F2023]/30">
                    <h3 className="font-bold flex items-center gap-2">
                      <Trophy size={18} className="text-yellow-400" />
                      Top 3 Players
                    </h3>
                  </div>
                  <div className="p-6 flex flex-col gap-6">
                    {players.slice(0, 3).map((player, idx) => (
                      <div key={player.id} className="flex items-center gap-4 group">
                        <div className="relative">
                          <div className="w-14 h-14 bg-[#0A0A0B] rounded-2xl border border-[#2A2B2F] flex items-center justify-center text-xl font-black group-hover:border-[#F27D26] transition-colors">
                            {player.name.charAt(0)}
                          </div>
                          <div className={cn(
                            "absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 border-[#151619]",
                            idx === 0 ? "bg-yellow-400 text-black" : 
                            idx === 1 ? "bg-gray-300 text-black" : "bg-amber-600 text-white"
                          )}>
                            {idx + 1}
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-bold text-sm group-hover:text-[#F27D26] transition-colors">{player.name}</h4>
                            <div className="flex items-center gap-1 bg-green-500/10 px-2 py-0.5 rounded-full">
                              <Target size={10} className="text-green-400" />
                              <span className="text-[9px] font-black text-green-400">NIR: {(9.2 - idx * 0.4).toFixed(1)}</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-wider">{teams.find(t => t.id === player.teamId)?.name}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex flex-col">
                              <span className="text-[10px] text-[#8E9299] uppercase font-bold">Goals</span>
                              <span className="text-sm font-black">{12 - idx * 2}</span>
                            </div>
                            <div className="w-[1px] h-6 bg-[#2A2B2F]"></div>
                            <div className="flex flex-col">
                              <span className="text-[10px] text-[#8E9299] uppercase font-bold">Assists</span>
                              <span className="text-sm font-black">{8 - idx}</span>
                            </div>
                            <div className="w-[1px] h-6 bg-[#2A2B2F]"></div>
                            <div className="flex flex-col">
                              <span className="text-[10px] text-[#8E9299] uppercase font-bold">Status</span>
                              <span className={cn(
                                "text-[10px] font-black uppercase",
                                player.status === 'active' ? "text-green-400" : "text-red-400"
                              )}>{player.status}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {players.length === 0 && (
                      <div className="text-center py-10 text-[#8E9299] text-sm italic">
                        No player data available. Seed the system to see rankings.
                      </div>
                    )}
                  </div>
                  <div className="p-4 bg-[#0F1012] border-t border-[#2A2B2F]">
                    <button className="w-full py-2 bg-[#1F2023] hover:bg-[#2A2B2F] text-[#8E9299] hover:text-white rounded-xl text-xs font-bold transition-all">
                      View Full Scouting Report
                    </button>
                  </div>
                </div>
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-bold flex items-center gap-2">
                        <TrendingUp size={18} className="text-[#F27D26]" />
                        National Performance Trend
                      </h3>
                      <p className="text-[10px] text-[#8E9299] uppercase font-bold tracking-widest mt-1">AI Decision Accuracy Index</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#F27D26]"></div>
                        <span className="text-[10px] font-bold text-[#8E9299]">CURRENT</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#3B82F6]"></div>
                        <span className="text-[10px] font-bold text-[#8E9299]">TARGET</span>
                      </div>
                    </div>
                  </div>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={accuracyData}>
                        <defs>
                          <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F27D26" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#F27D26" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F2023" vertical={false} />
                        <XAxis dataKey="name" stroke="#8E9299" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#8E9299" fontSize={10} tickLine={false} axisLine={false} domain={[80, 100]} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2A2B2F', borderRadius: '12px' }}
                          itemStyle={{ color: '#F27D26' }}
                        />
                        <Area type="monotone" dataKey="accuracy" stroke="#F27D26" strokeWidth={3} fillOpacity={1} fill="url(#colorAcc)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl">
                  <h3 className="font-bold flex items-center gap-2 mb-6">
                    <BarChart3 size={18} className="text-[#3B82F6]" />
                    Discipline Distribution
                  </h3>
                  <div className="h-[300px] w-full flex items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={decisionTypes}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={8}
                          dataKey="value"
                        >
                          {decisionTypes.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2A2B2F', borderRadius: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-3 pr-8">
                      {decisionTypes.map((item) => (
                        <div key={item.name} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                          <span className="text-xs text-[#8E9299] font-medium">{item.name}</span>
                          <span className="text-xs font-bold ml-auto">{item.value}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* System Status & Quick Actions */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold flex items-center gap-2 mb-4">
                      <ShieldCheck size={18} className="text-green-400" />
                      Security & Integrity
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8E9299] font-bold uppercase">Encryption</span>
                        <span className="text-xs font-black text-green-400">AES-256 ACTIVE</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8E9299] font-bold uppercase">Auth Protocol</span>
                        <span className="text-xs font-black text-green-400">OAUTH 2.0</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#8E9299] font-bold uppercase">Data Residency</span>
                        <span className="text-xs font-black">NATIONAL CLOUD</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 pt-6 border-t border-[#2A2B2F]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Lock size={16} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-xs font-black">SYSTEM SECURE</p>
                        <p className="text-[10px] text-[#8E9299]">Last audit: 2h ago</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 bg-[#151619] border border-[#2A2B2F] p-6 rounded-2xl">
                  <h3 className="font-bold flex items-center gap-2 mb-6">
                    <Activity size={18} className="text-[#3B82F6]" />
                    Real-time Intelligence Stream
                  </h3>
                  <div className="space-y-4">
                    {[
                      { time: '06:12', msg: 'AI detected potential offside in Match #104. VAR review initiated.', type: 'info' },
                      { time: '06:08', msg: 'Discipline Engine flagged Player "M. Salah" for 3rd yellow card.', type: 'warning' },
                      { time: '05:55', msg: 'System integrity check completed. 0 vulnerabilities found.', type: 'success' },
                      { time: '05:42', msg: 'New match data synchronized from National Feed.', type: 'info' },
                    ].map((item, i) => (
                      <div key={i} className="flex gap-4 p-3 rounded-xl bg-[#0A0A0B] border border-[#1F2023] hover:border-[#2A2B2F] transition-colors">
                        <span className="text-[10px] font-mono text-[#8E9299] mt-0.5">{item.time}</span>
                        <p className="text-xs text-[#E4E3E0] leading-relaxed">{item.msg}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'matches' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Match Management</h2>
                  <p className="text-[#8E9299] text-sm mt-1">Real-time score updates and event recording.</p>
                </div>
                <button className="bg-[#F27D26] text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-[#F27D26]/20">
                  <Plus size={18} />
                  Schedule New Match
                </button>
              </div>

              {/* Event Submission Modal */}
              {eventFormMatch && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                    <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between bg-[#1F2023]/30">
                      <h3 className="font-bold flex items-center gap-2">
                        <Plus size={18} className="text-[#F27D26]" />
                        Submit Match Event
                      </h3>
                      <button onClick={() => setEventFormMatch(null)} className="text-[#8E9299] hover:text-white">
                        <LogOut size={18} className="rotate-180" />
                      </button>
                    </div>
                    <form onSubmit={handleManualEventSubmit} className="p-6 space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Incident Context (Match)</label>
                        <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl text-sm font-bold flex items-center justify-between">
                          <span>{teams.find(t => t.id === eventFormMatch.homeTeamId)?.name}</span>
                          <span className="text-[#8E9299] px-2">VS</span>
                          <span>{teams.find(t => t.id === eventFormMatch.awayTeamId)?.name}</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Subject Identification (Player)</label>
                        <select 
                          required
                          value={eventFormPlayerId}
                          onChange={(e) => setEventFormPlayerId(e.target.value)}
                          className="w-full bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl text-sm outline-none focus:border-[#F27D26] transition-colors appearance-none"
                        >
                          <option value="">Select Subject</option>
                          {players
                            .filter(p => p.teamId === eventFormMatch.homeTeamId || p.teamId === eventFormMatch.awayTeamId)
                            .map(p => (
                              <option key={p.id} value={p.id}>{p.name} — {teams.find(t => t.id === p.teamId)?.name}</option>
                            ))
                          }
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Incident Type</label>
                          <select 
                            value={eventFormType}
                            onChange={(e) => setEventFormType(e.target.value as any)}
                            className="w-full bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl text-sm outline-none focus:border-[#F27D26] transition-colors appearance-none"
                          >
                            <option value="goal">Goal Scored</option>
                            <option value="yellow_card">Yellow Card Issued</option>
                            <option value="red_card">Red Card Issued</option>
                            <option value="foul">Foul Detected</option>
                            <option value="substitution">Substitution</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Timestamp (Min)</label>
                          <input 
                            required
                            type="number"
                            min="0"
                            max="120"
                            value={eventFormMinute}
                            onChange={(e) => setEventFormMinute(parseInt(e.target.value))}
                            className="w-full bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl text-sm outline-none focus:border-[#F27D26] transition-colors"
                            placeholder="Minute"
                          />
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4">
                        <button 
                          type="button"
                          onClick={() => setEventFormMatch(null)}
                          className="flex-1 bg-[#1F2023] text-[#8E9299] py-4 rounded-xl font-bold text-sm hover:bg-[#2A2B2F] transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          className="flex-1 bg-[#F27D26] text-white py-4 rounded-xl font-bold text-sm hover:scale-105 transition-transform shadow-lg shadow-[#F27D26]/20"
                        >
                          Submit Report
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-1 gap-6">
                {matches.map(match => {
                  const homeTeam = teams.find(t => t.id === match.homeTeamId);
                  const awayTeam = teams.find(t => t.id === match.awayTeamId);
                  
                  return (
                    <div key={match.id} className="bg-[#151619] rounded-2xl border border-[#2A2B2F] overflow-hidden shadow-xl">
                      {/* Match Header */}
                      <div className="bg-[#1F2023]/50 px-6 py-3 border-b border-[#2A2B2F] flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 text-xs font-bold text-[#8E9299]">
                            <Clock size={14} />
                            <span>{format(safeDate(match.date), 'PPP p')}</span>
                          </div>
                          <div className="h-3 w-[1px] bg-[#2A2B2F]"></div>
                          <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Match ID: {match.id.slice(0, 8)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20">
                            <Cpu size={12} />
                            <span className="text-[9px] font-black uppercase tracking-tighter">AI Analysis Active</span>
                          </div>
                          <div className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter",
                            match.status === 'live' ? "bg-red-500 text-white animate-pulse" : 
                            match.status === 'completed' ? "bg-green-500/20 text-green-400" : "bg-[#2A2B2F] text-[#8E9299]"
                          )}>
                            {match.status}
                          </div>
                        </div>
                      </div>

                      <div className="p-8 flex items-center justify-between gap-8">
                        {/* Home Team Actions */}
                        <div className="flex flex-col items-center gap-4 w-48">
                          <div className="w-16 h-16 bg-[#0A0A0B] rounded-2xl border border-[#2A2B2F] flex items-center justify-center shadow-inner">
                            <Shield size={32} className="text-[#F27D26]" />
                          </div>
                          <div className="text-center">
                            <h4 className="font-bold text-lg">{homeTeam?.name || 'Home Team'}</h4>
                            <p className="text-[10px] text-[#8E9299] uppercase tracking-widest mt-1">{homeTeam?.location || 'National Stadium'}</p>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.homeTeamId)?.id;
                                handleAddEvent(match.id, 'goal', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-green-500/10 text-green-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-green-500/30"
                              title="Home Goal"
                            >
                              <Trophy size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.homeTeamId)?.id;
                                handleAddEvent(match.id, 'yellow_card', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-yellow-500/10 text-yellow-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-yellow-500/30"
                              title="Home Yellow Card"
                            >
                              <AlertCircle size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.homeTeamId)?.id;
                                handleAddEvent(match.id, 'red_card', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-red-500/10 text-red-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-red-500/30"
                              title="Home Red Card"
                            >
                              <ShieldAlert size={16} />
                            </button>
                          </div>
                        </div>

                        {/* Score Display */}
                        <div className="flex flex-col items-center justify-center gap-2">
                          <div className="flex items-center gap-8">
                            <span className="text-6xl font-black tracking-tighter text-white">{match.homeScore}</span>
                            <span className="text-4xl font-black text-[#2A2B2F]">:</span>
                            <span className="text-6xl font-black tracking-tighter text-white">{match.awayScore}</span>
                          </div>
                          <button 
                            onClick={() => setEventFormMatch(match)}
                            className="px-4 py-1.5 bg-[#F27D26] text-white rounded-full border border-[#F27D26]/20 flex items-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-[#F27D26]/20"
                          >
                            <Plus size={14} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Record Manual Event</span>
                          </button>
                        </div>

                        {/* Away Team Actions */}
                        <div className="flex flex-col items-center gap-4 w-48">
                          <div className="w-16 h-16 bg-[#0A0A0B] rounded-2xl border border-[#2A2B2F] flex items-center justify-center shadow-inner">
                            <Shield size={32} className="text-[#3B82F6]" />
                          </div>
                          <div className="text-center">
                            <h4 className="font-bold text-lg">{awayTeam?.name || 'Away Team'}</h4>
                            <p className="text-[10px] text-[#8E9299] uppercase tracking-widest mt-1">{awayTeam?.location || 'National Stadium'}</p>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.awayTeamId)?.id;
                                handleAddEvent(match.id, 'goal', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-green-500/10 text-green-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-green-500/30"
                              title="Away Goal"
                            >
                              <Trophy size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.awayTeamId)?.id;
                                handleAddEvent(match.id, 'yellow_card', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-yellow-500/10 text-yellow-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-yellow-500/30"
                              title="Away Yellow Card"
                            >
                              <AlertCircle size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                const pId = players.find(p => p.teamId === match.awayTeamId)?.id;
                                handleAddEvent(match.id, 'red_card', pId);
                              }}
                              className="p-2.5 bg-[#0A0A0B] hover:bg-red-500/10 text-red-400 rounded-xl transition-all border border-[#2A2B2F] hover:border-red-500/30"
                              title="Away Red Card"
                            >
                              <ShieldAlert size={16} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Match Footer / Quick Stats */}
                      <div className="bg-[#0F1012] px-6 py-4 border-t border-[#2A2B2F] flex items-center justify-around">
                        <div className="flex items-center gap-2">
                          <Activity size={14} className="text-[#8E9299]" />
                          <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Possession: 52% - 48%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp size={14} className="text-[#8E9299]" />
                          <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">xG: 1.45 - 0.82</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ScaleIcon size={14} className="text-[#8E9299]" />
                          <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">VAR Reviews: 2</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">System Audit Log</h2>
                  <p className="text-[#8E9299] text-sm mt-1">Full traceability of all AI decisions and system events.</p>
                </div>
                <button className="bg-[#1F2023] text-white px-4 py-2 rounded-xl font-bold text-sm border border-[#2A2B2F] flex items-center gap-2">
                  <Download size={16} />
                  Export Audit Trail
                </button>
              </div>

              <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Auth Service</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Database</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest">AI Engine</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#8E9299]">Uptime: 99.998%</span>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0F1012] text-[#8E9299] text-[10px] uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">Timestamp</th>
                      <th className="px-6 py-4">Event ID</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Description</th>
                      <th className="px-6 py-4">Integrity Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2023] text-xs">
                    {[
                      { time: '2026-03-27 06:12:45', id: 'EVT-9021', cat: 'AI_DECISION', desc: 'Offside detection confirmed in Match #104', hash: 'sha256:8f2e...3a1' },
                      { time: '2026-03-27 06:10:12', id: 'EVT-9020', cat: 'AUTH', desc: 'Admin login from 192.168.1.45', hash: 'sha256:4d1a...9c2' },
                      { time: '2026-03-27 06:08:33', id: 'EVT-9019', cat: 'DISCIPLINE', desc: 'Suspension flag raised for Player ID: 552', hash: 'sha256:1b9c...f4d' },
                      { time: '2026-03-27 06:05:01', id: 'EVT-9018', cat: 'SYSTEM', desc: 'Automated backup completed successfully', hash: 'sha256:7e3a...2b8' },
                      { time: '2026-03-27 06:02:15', id: 'EVT-9017', cat: 'AI_DECISION', desc: 'VAR replay generated for Match #102', hash: 'sha256:9f4d...1e0' },
                    ].map((log, i) => (
                      <tr key={i} className="hover:bg-[#1F2023] transition-colors">
                        <td className="px-6 py-4 font-mono text-[#8E9299]">{log.time}</td>
                        <td className="px-6 py-4 font-bold">{log.id}</td>
                        <td className="px-6 py-4">
                          <span className="bg-[#1F2023] border border-[#2A2B2F] px-2 py-1 rounded text-[10px] font-bold uppercase">{log.cat}</span>
                        </td>
                        <td className="px-6 py-4 text-[#E4E3E0]">{log.desc}</td>
                        <td className="px-6 py-4 font-mono text-[10px] text-[#8E9299]">{log.hash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'discipline' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Discipline Registry</h2>
                  <p className="text-[#8E9299] text-sm mt-1">Tracking player conduct and suspension status.</p>
                </div>
                <div className="flex gap-2">
                  <button className="bg-[#1F2023] text-white px-4 py-2 rounded-xl font-bold text-sm border border-[#2A2B2F]">Download Report</button>
                </div>
              </div>

              <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0F1012] text-[#8E9299] text-[10px] uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">Player</th>
                      <th className="px-6 py-4">Team</th>
                      <th className="px-6 py-4 text-center">NIR Index</th>
                      <th className="px-6 py-4 text-center">Yellow Cards</th>
                      <th className="px-6 py-4 text-center">Red Cards</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2023] text-sm">
                    {discipline.map((record) => {
                      const player = players.find(p => p.id === record.playerId);
                      const team = teams.find(t => t.id === player?.teamId);
                      const nir = (8.5 + Math.random() * 1.5).toFixed(1);
                      
                      return (
                        <tr key={record.id} className="hover:bg-[#1F2023] transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-[#0A0A0B] rounded-xl border border-[#2A2B2F] flex items-center justify-center text-[10px] font-bold group-hover:border-[#F27D26] transition-colors">
                                {player?.name.charAt(0)}
                              </div>
                              <span className="font-bold">{player?.name || 'Unknown Player'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-[#8E9299]">{team?.name || 'Free Agent'}</td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-green-400"></div>
                              <span className="font-mono font-bold text-green-400">{nir}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded font-mono font-bold">{record.yellowCards}</span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded font-mono font-bold">{record.redCards}</span>
                          </td>
                          <td className="px-6 py-4">
                            {record.suspended ? (
                              <div className="flex items-center gap-1.5 text-red-400">
                                <ShieldAlert size={14} />
                                <span className="text-[10px] font-bold uppercase">Suspended</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-green-400">
                                <ShieldCheck size={14} />
                                <span className="text-[10px] font-bold uppercase">Eligible</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button className="text-[#8E9299] hover:text-white transition-colors">
                              <Settings size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {discipline.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-20 text-center text-[#8E9299]">
                          No disciplinary records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'rankings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Top Scorers */}
              <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between bg-[#1F2023]/30">
                  <h3 className="font-bold flex items-center gap-2">
                    <Trophy size={18} className="text-yellow-400" />
                    Top Scorers
                  </h3>
                  <span className="text-[10px] text-[#8E9299] font-bold uppercase tracking-widest">Season 2026</span>
                </div>
                <div className="divide-y divide-[#1F2023]">
                  {players.slice(0, 5).map((player, idx) => (
                    <div key={player.id} className="p-4 flex items-center justify-between hover:bg-[#1F2023] transition-colors">
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-black text-[#2A2B2F] w-6">{idx + 1}</span>
                        <div>
                          <p className="font-bold text-sm">{player.name}</p>
                          <p className="text-[10px] text-[#8E9299] uppercase font-semibold">{teams.find(t => t.id === player.teamId)?.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-black text-[#F27D26]">{Math.floor(Math.random() * 10) + 5}</p>
                        <p className="text-[10px] text-[#8E9299] uppercase font-bold">Goals</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fair Play Table */}
              <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between bg-[#1F2023]/30">
                  <h3 className="font-bold flex items-center gap-2">
                    <ShieldCheck size={18} className="text-green-400" />
                    Fair Play Table
                  </h3>
                  <span className="text-[10px] text-[#8E9299] font-bold uppercase tracking-widest">Conduct Index</span>
                </div>
                <div className="divide-y divide-[#1F2023]">
                  {teams.slice(0, 5).map((team, idx) => (
                    <div key={team.id} className="p-4 flex items-center justify-between hover:bg-[#1F2023] transition-colors">
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-black text-[#2A2B2F] w-6">{idx + 1}</span>
                        <div>
                          <p className="font-bold text-sm">{team.name}</p>
                          <p className="text-[10px] text-[#8E9299] uppercase font-semibold">{team.location}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <p className="text-sm font-bold text-yellow-400">{Math.floor(Math.random() * 20)}</p>
                          <div className="w-3 h-4 bg-yellow-400/20 rounded-sm mx-auto mt-1 border border-yellow-400/30"></div>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-bold text-red-400">{Math.floor(Math.random() * 3)}</p>
                          <div className="w-3 h-4 bg-red-400/20 rounded-sm mx-auto mt-1 border border-red-400/30"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'decisions' && (
            <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden">
               <div className="p-6 border-b border-[#2A2B2F] flex items-center justify-between">
                <h3 className="text-2xl font-bold">VAR Decision Log</h3>
                <div className="flex gap-2">
                   <button className="bg-[#1F2023] text-white px-3 py-1.5 rounded-lg text-xs font-bold">Export CSV</button>
                   <button className="bg-[#F27D26] text-white px-3 py-1.5 rounded-lg text-xs font-bold">Filter</button>
                </div>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0F1012] text-[#8E9299] text-[10px] uppercase tracking-wider font-bold">
                    <th className="px-6 py-4">ID</th>
                    <th className="px-6 py-4">Match</th>
                    <th className="px-6 py-4">Initial</th>
                    <th className="px-6 py-4">Final</th>
                    <th className="px-6 py-4">Confidence</th>
                    <th className="px-6 py-4">Reviewer</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2023] text-sm">
                  {decisions.map((d, idx) => (
                    <tr key={d.id} className="hover:bg-[#1F2023] transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-[#8E9299]">#{d.id.slice(0, 6)}</td>
                      <td className="px-6 py-4 font-bold">Match #{idx + 1}</td>
                      <td className="px-6 py-4">
                        <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded text-[10px] font-bold">{d.initialDecision}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded text-[10px] font-bold">{d.finalDecision}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#0A0A0B] rounded-full overflow-hidden">
                            <div className="h-full bg-[#F27D26]" style={{ width: `${d.confidenceScore * 100}%` }}></div>
                          </div>
                          <span className="text-[10px] font-bold">{(d.confidenceScore * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[#8E9299]">{d.reviewer}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircle2 size={14} />
                          <span className="text-[10px] font-bold uppercase">Verified</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setActiveTab('dashboard');
                              setTimeout(() => seekTo(Math.random() * 300), 100);
                            }}
                            className="p-2 bg-[#1F2023] text-[#8E9299] hover:text-white rounded-lg transition-colors"
                            title="Watch Replay"
                          >
                            <Play size={14} />
                          </button>
                          <button 
                            onClick={() => handleGenerateClip(d.id)}
                            disabled={clipStatus[d.id] === 'processing'}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                              clipStatus[d.id] === 'ready' 
                                ? "bg-green-500 text-white" 
                                : "bg-[#1F2023] text-[#8E9299] hover:text-white"
                            )}
                          >
                            {clipStatus[d.id] === 'processing' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : clipStatus[d.id] === 'ready' ? (
                              <CheckCircle2 size={14} />
                            ) : (
                              <Video size={14} />
                            )}
                            {clipStatus[d.id] === 'processing' ? 'Processing...' : clipStatus[d.id] === 'ready' ? 'Clip Ready' : 'Generate Clip'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {decisions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center text-[#8E9299]">
                        No decisions logged in the system.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'dataset' && (
            <div className="flex flex-col gap-8">
              <div className="bg-[#151619] border border-[#2A2B2F] p-8 rounded-2xl">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-bold">AI Dataset Builder</h3>
                    <p className="text-[#8E9299] text-sm mt-2">Export match events and VAR decisions for AI model training (COCO format).</p>
                  </div>
                  <button 
                    onClick={handleExportDataset}
                    className="bg-[#F27D26] text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:scale-105 transition-transform"
                  >
                    <Download size={20} />
                    Export Full Dataset
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-6 rounded-2xl">
                    <p className="text-[#8E9299] text-[10px] uppercase font-bold tracking-widest mb-2">Total Samples</p>
                    <h4 className="text-3xl font-bold">{decisions.length + matches.length}</h4>
                  </div>
                  <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-6 rounded-2xl">
                    <p className="text-[#8E9299] text-[10px] uppercase font-bold tracking-widest mb-2">Annotated Frames</p>
                    <h4 className="text-3xl font-bold">{decisions.length * 4}</h4>
                  </div>
                  <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-6 rounded-2xl">
                    <p className="text-[#8E9299] text-[10px] uppercase font-bold tracking-widest mb-2">Dataset Health</p>
                    <h4 className="text-3xl font-bold text-green-400">98.2%</h4>
                  </div>
                </div>
              </div>

              <div className="bg-[#151619] border border-[#2A2B2F] p-8 rounded-2xl">
                <h3 className="text-lg font-bold mb-6">Export Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="flex flex-col gap-4">
                    <label className="text-xs font-bold text-[#8E9299] uppercase">Format</label>
                    <select className="bg-[#0A0A0B] border border-[#2A2B2F] p-3 rounded-xl outline-none focus:border-[#F27D26]">
                      <option>COCO (JSON)</option>
                      <option>YOLO (TXT)</option>
                      <option>Pascal VOC (XML)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-4">
                    <label className="text-xs font-bold text-[#8E9299] uppercase">Include Metadata</label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" defaultChecked className="accent-[#F27D26]" />
                        <span className="text-sm">Referee Audio</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" defaultChecked className="accent-[#F27D26]" />
                        <span className="text-sm">Player Stats</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'intelligence' && (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white">AI Intelligence Hub</h2>
                  <p className="text-[#8E9299] text-sm mt-1">Advanced Gemini-powered football intelligence and generation.</p>
                </div>
                {!hasApiKey && (
                  <button 
                    onClick={handleSelectApiKey}
                    className="bg-[#F27D26] text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:scale-105 transition-transform shadow-lg shadow-[#F27D26]/20"
                  >
                    <Shield size={18} />
                    Connect Paid API Key
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chat Interface */}
                <div className="lg:col-span-2 bg-[#151619] border border-[#2A2B2F] rounded-2xl flex flex-col h-[600px] overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#F27D26]/10 flex items-center justify-center">
                        <MessageSquare size={18} className="text-[#F27D26]" />
                      </div>
                      <h3 className="font-bold text-sm text-white">Intelligence Chatbot</h3>
                    </div>
                    <button 
                      onClick={() => setChatMessages([])}
                      className="text-[#8E9299] hover:text-red-400 transition-colors"
                      title="Clear History"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                    {chatMessages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                        <Sparkles size={48} className="text-[#F27D26]" />
                        <div>
                          <p className="text-sm font-bold text-white">System Initialized</p>
                          <p className="text-xs text-[#8E9299]">Ask me about match analysis, player stats, or disciplinary rules.</p>
                        </div>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={cn(
                        "flex gap-4 max-w-[85%]",
                        msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                      )}>
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center",
                          msg.role === 'user' ? "bg-[#3B82F6]" : "bg-[#F27D26]"
                        )}>
                          {msg.role === 'user' ? <Users size={16} className="text-white" /> : <Cpu size={16} className="text-white" />}
                        </div>
                        <div className={cn(
                          "p-4 rounded-2xl text-sm leading-relaxed",
                          msg.role === 'user' ? "bg-[#3B82F6]/10 text-blue-100 rounded-tr-none" : "bg-[#1F2023] text-gray-200 rounded-tl-none"
                        )}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="flex gap-4 max-w-[85%]">
                        <div className="w-8 h-8 rounded-lg bg-[#F27D26] flex items-center justify-center">
                          <Loader2 size={16} className="animate-spin text-white" />
                        </div>
                        <div className="p-4 rounded-2xl bg-[#1F2023] text-gray-400 text-sm italic rounded-tl-none">
                          Analyzing intelligence feed...
                        </div>
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleChatSubmit} className="p-4 border-t border-[#2A2B2F] bg-[#0F1012]">
                    <div className="relative">
                      <input 
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Inquire about system data..."
                        className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl py-4 pl-6 pr-14 text-sm outline-none focus:border-[#F27D26] transition-all text-white"
                      />
                      <button 
                        type="submit"
                        disabled={isChatLoading || !chatInput.trim()}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-[#F27D26] text-white rounded-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                      >
                        <Send size={18} />
                      </button>
                    </div>
                  </form>
                </div>

                {/* Side Tools */}
                <div className="space-y-6">
                  {/* Image Generation */}
                  <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center gap-3">
                      <ImageIcon size={18} className="text-[#F27D26]" />
                      <h3 className="font-bold text-sm text-white">Visual Generator</h3>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Prompt</label>
                        <textarea 
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          placeholder="e.g. A cinematic shot of a striker celebrating a goal in Kigali..."
                          className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl p-3 text-xs outline-none focus:border-[#F27D26] h-24 resize-none text-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Aspect Ratio</label>
                          <select 
                            value={aspectRatio}
                            onChange={(e) => setAspectRatio(e.target.value)}
                            className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-lg p-2 text-xs outline-none text-white"
                          >
                            <option value="1:1">1:1 Square</option>
                            <option value="16:9">16:9 Wide</option>
                            <option value="9:16">9:16 Portrait</option>
                            <option value="21:9">21:9 Ultra</option>
                          </select>
                        </div>
                        <button 
                          onClick={handleImageGeneration}
                          disabled={isGeneratingImage || !imagePrompt.trim()}
                          className="self-end bg-[#F27D26] text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#D96D1D] transition-colors disabled:opacity-50"
                        >
                          {isGeneratingImage ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Generate
                        </button>
                      </div>
                      {generatedImage && (
                        <div className="mt-4 relative group">
                          <img src={generatedImage} alt="Generated" className="w-full rounded-xl border border-[#2A2B2F]" referrerPolicy="no-referrer" />
                          <button 
                            onClick={() => setGeneratedImage(null)}
                            className="absolute top-2 right-2 p-1 bg-black/60 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Search Grounding */}
                  <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center gap-3">
                      <Globe size={18} className="text-blue-400" />
                      <h3 className="font-bold text-sm text-white">Global Search Grounding</h3>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="relative">
                        <input 
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search global football news..."
                          className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl py-3 pl-4 pr-10 text-xs outline-none focus:border-blue-400 text-white"
                        />
                        <button 
                          onClick={handleSearch}
                          disabled={isSearching || !searchQuery.trim()}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-blue-400"
                        >
                          {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                        </button>
                      </div>
                      {searchResult && (
                        <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl space-y-3">
                          <p className="text-xs leading-relaxed text-gray-300">{searchResult.text}</p>
                          {searchResult.sources.length > 0 && (
                            <div className="pt-3 border-t border-[#2A2B2F]">
                              <p className="text-[9px] font-black uppercase tracking-widest text-[#8E9299] mb-2">Sources</p>
                              <div className="flex flex-wrap gap-2">
                                {searchResult.sources.map((src: any, i: number) => (
                                  <a key={i} href={src.uri} target="_blank" rel="noreferrer" className="text-[9px] text-blue-400 hover:underline truncate max-w-[150px]">
                                    {src.title || src.uri}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Maps Grounding */}
                <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center gap-3">
                    <MapPin size={18} className="text-green-400" />
                    <h3 className="font-bold text-sm text-white">Maps Grounding (Stadiums & Facilities)</h3>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="relative">
                      <input 
                        type="text"
                        value={mapsQuery}
                        onChange={(e) => setMapsQuery(e.target.value)}
                        placeholder="Find stadiums or training centers..."
                        className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl py-3 pl-4 pr-10 text-xs outline-none focus:border-green-400 text-white"
                      />
                      <button 
                        onClick={handleMapsSearch}
                        disabled={isMapping || !mapsQuery.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-green-400"
                      >
                        {isMapping ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                      </button>
                    </div>
                    {mapsResult && (
                      <div className="bg-[#0A0A0B] border border-[#2A2B2F] p-4 rounded-xl space-y-3">
                        <p className="text-xs leading-relaxed text-gray-300">{mapsResult.text}</p>
                        {mapsResult.sources.length > 0 && (
                          <div className="pt-3 border-t border-[#2A2B2F]">
                            <p className="text-[9px] font-black uppercase tracking-widest text-[#8E9299] mb-2">Location Data</p>
                            <div className="flex flex-col gap-2">
                              {mapsResult.sources.map((src: any, i: number) => (
                                <a key={i} href={src.uri} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[10px] text-green-400 hover:underline">
                                  <MapPin size={10} />
                                  {src.title || 'View on Maps'}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Veo Video Generation */}
                <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-[#2A2B2F] bg-[#1F2023]/30 flex items-center gap-3">
                    <Video size={18} className="text-purple-400" />
                    <h3 className="font-bold text-sm text-white">Veo Video Generation</h3>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-[#8E9299]">Video Prompt</label>
                      <textarea 
                        value={veoPrompt}
                        onChange={(e) => setVeoPrompt(e.target.value)}
                        placeholder="Describe the scene you want to generate..."
                        className="w-full bg-[#0A0A0B] border border-[#2A2B2F] rounded-xl p-3 text-xs outline-none focus:border-purple-400 h-24 resize-none text-white"
                      />
                    </div>
                    <button 
                      onClick={handleVeoGeneration}
                      disabled={isGeneratingVeo || !veoPrompt.trim() || !hasApiKey}
                      className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      {isGeneratingVeo ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                      {hasApiKey ? 'Generate Cinematic Video' : 'Connect API Key to Generate'}
                    </button>
                    {veoResult && (
                      <div className="mt-4 relative group">
                        <video src={veoResult} controls className="w-full rounded-xl border border-[#2A2B2F]" />
                        <button 
                          onClick={() => setVeoResult(null)}
                          className="absolute top-2 right-2 p-1 bg-black/60 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
