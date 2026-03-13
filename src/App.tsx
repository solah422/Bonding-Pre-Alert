import React, { useState, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { 
  Upload, 
  Filter, 
  RefreshCcw, 
  Copy, 
  CheckCircle2, 
  AlertCircle, 
  Search,
  Settings2,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
  Brain,
  Eye,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Download,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ManifestRow {
  HAWB: string;
  ConsigneeName: string;
  ConsigneeContactNo: string;
  UnitPrice: string;
  PackageDesc: string;
  [key: string]: any;
}

interface FlaggedRow extends ManifestRow {
  reasons: ('Price' | 'Duplicate' | 'Keyword' | 'AI' | 'Manual')[];
  matchedKeywords?: string[];
  aiReason?: string;
}

interface FilterSettings {
  priceThreshold: number;
  keywords: string[];
  checkDuplicates: boolean;
  aiEnabled: boolean;
  geminiApiKey: string;
}

interface AIResult {
  hawb: string;
  isRestricted: boolean;
  reason: string;
}

const DEFAULT_SETTINGS: FilterSettings = {
  priceThreshold: 648,
  keywords: [
    'supplements', 
    'food', 
    'drinks', 
    'mobile phones', 
    'vehicle spare parts', 
    'baby food', 
    'baby bottle'
  ],
  checkDuplicates: true,
  aiEnabled: false,
  geminiApiKey: '',
};

// --- Components ---

export default function App() {
  const [data, setData] = useState<ManifestRow[]>([]);
  const [settings, setSettings] = useState<FilterSettings>(() => {
    const saved = localStorage.getItem('bonding_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [manualFlags, setManualFlags] = useState<Set<string>>(new Set());
  const [aiResults, setAiResults] = useState<Record<string, AIResult>>({});
  const [aiScannedHawbs, setAiScannedHawbs] = useState<Set<string>>(new Set());
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [auditItem, setAuditItem] = useState<ManifestRow | null>(null);
  const [checkedHawbs, setCheckedHawbs] = useState<Set<string>>(new Set());
  const [showCheckedTable, setShowCheckedTable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save settings to localStorage
  React.useEffect(() => {
    localStorage.setItem('bonding_settings', JSON.stringify(settings));
  }, [settings]);

  const processFile = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Invalid file format. Please upload a .csv file.');
      return;
    }

    setError(null);
    setFileName(file.name);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError('Error parsing CSV. Please check the file structure.');
          return;
        }
        
        const rows = results.data as ManifestRow[];
        if (rows.length === 0) {
          setError('The uploaded CSV is empty.');
          return;
        }

        // Basic validation of required columns
        const required = ['HAWB', 'ConsigneeName', 'ConsigneeContactNo', 'UnitPrice', 'PackageDesc'];
        const headers = Object.keys(rows[0]);
        const missing = required.filter(col => !headers.includes(col));
        
        if (missing.length > 0) {
          setError(`Missing required columns: ${missing.join(', ')}`);
          return;
        }

        setData(rows);
      },
      error: (err) => {
        setError(`Processing error: ${err.message}`);
      }
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const resetToDefault = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const resetManifest = () => {
    setData([]);
    setFileName(null);
    setError(null);
    setManualFlags(new Set());
    setAiResults({});
    setAiScannedHawbs(new Set());
    setCheckedHawbs(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const { selected, notSelected, checked, stats } = useMemo(() => {
    if (data.length === 0) return { selected: [], notSelected: [], checked: [], stats: null };

    const counts = new Map<string, number>();
    if (settings.checkDuplicates) {
      data.forEach(row => {
        const key = `${row.ConsigneeName?.trim().toLowerCase()}|${row.ConsigneeContactNo?.trim()}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    }

    const selectedRows: FlaggedRow[] = [];
    const notSelectedRows: ManifestRow[] = [];
    const checkedRows: ManifestRow[] = [];
    let totalBondedValue = 0;
    const reasonCounts = { Price: 0, Keyword: 0, Duplicate: 0, AI: 0, Manual: 0 };

    data.forEach(row => {
      const price = parseFloat(row.UnitPrice) || 0;
      const desc = row.PackageDesc?.toLowerCase() || '';
      const name = row.ConsigneeName?.trim().toLowerCase() || '';
      const contact = row.ConsigneeContactNo?.trim() || '';
      const key = `${name}|${contact}`;

      const reasons: ('Price' | 'Duplicate' | 'Keyword' | 'AI' | 'Manual')[] = [];
      const matchedKeywords: string[] = [];

      if (price >= settings.priceThreshold) reasons.push('Price');
      
      settings.keywords.forEach(kw => {
        if (desc.includes(kw.toLowerCase().trim())) {
          matchedKeywords.push(kw);
        }
      });
      if (matchedKeywords.length > 0) reasons.push('Keyword');
      
      if (settings.checkDuplicates && (counts.get(key) || 0) > 1) reasons.push('Duplicate');

      // AI Results
      if (aiResults[row.HAWB]) reasons.push('AI');

      // Manual Flags
      if (manualFlags.has(row.HAWB)) reasons.push('Manual');

      if (reasons.length > 0) {
        selectedRows.push({ 
          ...row, 
          reasons, 
          matchedKeywords,
          aiReason: aiResults[row.HAWB]?.reason
        });
        totalBondedValue += price;
        reasons.forEach(r => reasonCounts[r]++);
      } else if (checkedHawbs.has(row.HAWB)) {
        checkedRows.push(row);
      } else {
        notSelectedRows.push(row);
      }
    });

    const sortedSelected = [...selectedRows].sort((a, b) => {
      const aIsDup = a.reasons.includes('Duplicate');
      const bIsDup = b.reasons.includes('Duplicate');

      if (aIsDup && !bIsDup) return -1;
      if (!aIsDup && bIsDup) return 1;
      
      return (a.ConsigneeName || '').localeCompare(b.ConsigneeName || '');
    });

    const stats = {
      total: data.length,
      flagged: selectedRows.length,
      percentage: ((selectedRows.length / data.length) * 100).toFixed(1),
      totalValue: totalBondedValue.toFixed(2),
      topReason: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0][0]
    };

    return { selected: sortedSelected, notSelected: notSelectedRows, checked: checkedRows, stats };
  }, [data, settings, aiResults, manualFlags, checkedHawbs]);

  const toggleManualFlag = (hawb: string, fromAuditModal: boolean = false) => {
    const currentIndex = notSelected.findIndex(item => item.HAWB === hawb);
    const nextItem = (currentIndex !== -1 && currentIndex < notSelected.length - 1) 
      ? notSelected[currentIndex + 1] 
      : null;

    setManualFlags(prev => {
      const next = new Set(prev);
      if (next.has(hawb)) next.delete(hawb);
      else {
        next.add(hawb);
        // If we flag it, remove it from checked if it was there
        setCheckedHawbs(cp => {
          const cn = new Set(cp);
          cn.delete(hawb);
          return cn;
        });
      }
      return next;
    });
    
    if (fromAuditModal) {
      setAuditItem(nextItem);
    } else {
      setAuditItem(null);
    }
  };

  const markAsChecked = (hawb: string, fromAuditModal: boolean = false) => {
    const currentIndex = notSelected.findIndex(item => item.HAWB === hawb);
    const nextItem = (currentIndex !== -1 && currentIndex < notSelected.length - 1) 
      ? notSelected[currentIndex + 1] 
      : null;

    setCheckedHawbs(prev => {
      const next = new Set(prev);
      next.add(hawb);
      return next;
    });
    // If we mark as checked, remove from manual flags if it was there
    setManualFlags(prev => {
      const next = new Set(prev);
      next.delete(hawb);
      return next;
    });
    
    if (fromAuditModal) {
      setAuditItem(nextItem);
    } else {
      setAuditItem(null);
    }
  };

  const runAiClassification = async () => {
    if (!settings.geminiApiKey) {
      setError('Please provide a Gemini API Key in settings to use AI classification.');
      setIsSettingsOpen(true);
      return;
    }

    setIsAiScanning(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });

      // We only scan items currently in "Manual Check" that haven't been scanned
      const itemsToScan = notSelected.filter(item => !aiScannedHawbs.has(item.HAWB)).slice(0, 50); // Limit to 50 for demo/safety
      
      if (itemsToScan.length === 0) {
        setError('No unscanned items in Manual Check.');
        setIsAiScanning(false);
        return;
      }

      const prompt = `Analyze the following shipping manifest items for restricted goods. 
      Look for "masked" descriptions that might be trying to hide supplements, electronics, or other regulated items.
      Also explicitly flag any vehicle spare parts (car or motorcycle, e.g., "airblade exhaust cover").
      Return a JSON object with a "results" array containing objects with "hawb", "isRestricted" (boolean), and "reason" (string).
      
      Items:
      ${itemsToScan.map(item => `HAWB: ${item.HAWB}, Desc: ${item.PackageDesc}`).join('\n')}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    hawb: { type: Type.STRING },
                    isRestricted: { type: Type.BOOLEAN },
                    reason: { type: Type.STRING }
                  },
                  required: ["hawb", "isRestricted", "reason"]
                }
              }
            }
          }
        }
      });

      const text = response.text || "{}";
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const resultData = JSON.parse(cleanText);
      
      const newAiResults = { ...aiResults };
      
      if (resultData && Array.isArray(resultData.results)) {
        resultData.results.forEach((res: AIResult) => {
          if (res.isRestricted) {
            newAiResults[res.hawb] = res;
          }
        });
      }

      setAiResults(newAiResults);
      
      // Mark these items as scanned
      const newAiScanned = new Set(aiScannedHawbs);
      itemsToScan.forEach(item => newAiScanned.add(item.HAWB));
      setAiScannedHawbs(newAiScanned);

    } catch (err: any) {
      setError(`AI Classification failed: ${err.message}`);
    } finally {
      setIsAiScanning(false);
    }
  };

  const copyToClipboard = (rows: ManifestRow[]) => {
    const text = rows.map(r => `${r.HAWB}\t${r.ConsigneeName}\t${r.ConsigneeContactNo}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const exportToCSV = (rows: ManifestRow[], type: string) => {
    const exportData = rows.map(row => {
      const { reasons, matchedKeywords, aiReason, ...rest } = row as any;
      return {
        ...rest,
        ...(reasons ? { BondingReasons: reasons.join(', ') } : {}),
        ...(matchedKeywords && matchedKeywords.length > 0 ? { MatchedKeywords: matchedKeywords.join(', ') } : {}),
        ...(aiReason ? { AIReason: aiReason } : {})
      };
    });
    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `manifest_${type}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div 
      className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-[#1A1A1A] selection:text-white relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full Screen Drag Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#1A1A1A]/90 backdrop-blur-sm flex flex-col items-center justify-center p-12 pointer-events-none"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="border-2 border-dashed border-white/30 rounded-[40px] w-full h-full flex flex-col items-center justify-center gap-6"
            >
              <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center text-[#1A1A1A] shadow-2xl">
                <Upload size={48} />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-white tracking-tight">Drop Manifest to Screen</h2>
                <p className="text-white/60 text-lg">Release to start processing the CSV file</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E5E5E5] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1A1A1A] rounded-xl flex items-center justify-center text-white">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Bonding Pre-Alert</h1>
            <p className="text-xs text-[#666] uppercase tracking-wider font-medium">Manifest Analysis Tool</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {data.length > 0 && (
            <button 
              onClick={resetManifest}
              className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
            >
              <RefreshCcw size={16} />
              Reset Manifest
            </button>
          )}
          
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm font-medium",
              isSettingsOpen ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#1A1A1A] border-[#E5E5E5] hover:border-[#1A1A1A]"
            )}
          >
            <Settings2 size={16} />
            Bonding Rules
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".csv" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white rounded-lg hover:bg-black transition-colors text-sm font-medium shadow-sm"
          >
            <Upload size={16} />
            Upload Manifest
          </button>
        </div>
      </header>

      <main className="p-6 max-w-[1600px] mx-auto space-y-6">
        {/* Error Message */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={18} />
              <span className="text-sm font-medium">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="hover:bg-red-100 p-1 rounded-lg">
              <X size={16} />
            </button>
          </motion.div>
        )}

        {/* Settings Panel */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-sm space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 size={20} />
                    <h2 className="text-lg font-bold tracking-tight">Bonding Rules & Configuration</h2>
                  </div>
                  <button 
                    onClick={resetToDefault}
                    className="flex items-center gap-2 text-xs font-bold text-[#1A1A1A] hover:underline"
                  >
                    <RefreshCcw size={14} />
                    RESET TO DEFAULT
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {/* Price Threshold */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#999]">Price Threshold (USD)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999] text-sm">$</span>
                      <input 
                        type="number" 
                        value={settings.priceThreshold}
                        onChange={(e) => setSettings({ ...settings, priceThreshold: Number(e.target.value) })}
                        className="w-full pl-7 pr-4 py-2.5 bg-[#F9F9F9] border border-[#EEE] rounded-xl focus:outline-none focus:border-[#1A1A1A] transition-colors font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-[#999]">Identify items exceeding this price for potential bonding pre-alert.</p>
                  </div>

                  {/* Keywords */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#999]">Bonding Keywords</label>
                    <div className="flex flex-wrap gap-2 p-3 bg-[#F9F9F9] border border-[#EEE] rounded-xl min-h-[46px]">
                      {settings.keywords.map((kw, i) => (
                        <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#DDD] rounded-lg text-xs font-medium">
                          {kw}
                          <button 
                            onClick={() => setSettings({ ...settings, keywords: settings.keywords.filter((_, idx) => idx !== i) })}
                            className="text-[#999] hover:text-red-500"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input 
                        placeholder="Add keyword..."
                        className="bg-transparent border-none focus:outline-none text-xs flex-1 min-w-[100px]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val && !settings.keywords.includes(val)) {
                              setSettings({ ...settings, keywords: [...settings.keywords, val] });
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-[#999]">Keywords used to identify items that might get bonded (matches PackageDesc).</p>
                  </div>

                  {/* AI Settings */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#999]">AI Classification (Gemini)</label>
                      <div 
                        onClick={() => setSettings({ ...settings, aiEnabled: !settings.aiEnabled })}
                        className={cn(
                          "w-10 h-5 rounded-full relative cursor-pointer transition-colors",
                          settings.aiEnabled ? "bg-green-500" : "bg-[#DDD]"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                          settings.aiEnabled ? "left-6" : "left-1"
                        )} />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <input 
                        type="password" 
                        placeholder="Gemini API Key"
                        value={settings.geminiApiKey}
                        onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                        disabled={!settings.aiEnabled}
                        className="w-full px-4 py-2.5 bg-[#F9F9F9] border border-[#EEE] rounded-xl focus:outline-none focus:border-[#1A1A1A] transition-colors font-mono text-xs disabled:opacity-50"
                      />
                      <p className="text-[10px] text-[#999]">Required for intelligent PackageDesc analysis.</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-[#F5F5F5]">
                  <input 
                    type="checkbox" 
                    id="dup-check"
                    checked={settings.checkDuplicates}
                    onChange={(e) => setSettings({ ...settings, checkDuplicates: e.target.checked })}
                    className="w-4 h-4 accent-[#1A1A1A]"
                  />
                  <label htmlFor="dup-check" className="text-sm font-medium cursor-pointer select-none">
                    Identify duplicate consignees (Potential bonding risk)
                  </label>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {data.length > 0 && stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-[#E5E5E5] shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-[#999] uppercase tracking-wider">Bonding Rate</p>
                <h3 className="text-2xl font-bold tracking-tight">{stats.percentage}%</h3>
                <p className="text-[10px] text-[#666]">{stats.flagged} of {stats.total} items flagged</p>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-[#E5E5E5] shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                <DollarSign size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-[#999] uppercase tracking-wider">Potential Value</p>
                <h3 className="text-2xl font-bold tracking-tight">${stats.totalValue}</h3>
                <p className="text-[10px] text-[#666]">Total value of flagged items</p>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-[#E5E5E5] shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                <TrendingUp size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-[#999] uppercase tracking-wider">Top Reason</p>
                <h3 className="text-2xl font-bold tracking-tight">{stats.topReason}</h3>
                <p className="text-[10px] text-[#666]">Most frequent bonding trigger</p>
              </div>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-[#E5E5E5] shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                <Brain size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-[#999] uppercase tracking-wider">AI Status</p>
                <h3 className="text-2xl font-bold tracking-tight">{settings.aiEnabled ? 'Active' : 'Disabled'}</h3>
                <p className="text-[10px] text-[#666]">{Object.keys(aiResults).length} AI detections</p>
              </div>
            </div>
          </div>
        )}

        {data.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div 
              className="lg:col-span-2 bg-white border-2 border-dashed border-[#E5E5E5] rounded-3xl h-[450px] flex flex-col items-center justify-center text-center p-12 transition-all"
            >
              <div className="w-16 h-16 bg-[#F9F9F9] text-[#CCC] rounded-2xl flex items-center justify-center mb-4 transition-colors">
                <Upload size={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Upload manifest for pre-alert</h3>
              <p className="text-[#666] max-w-md mb-8">
                Drag and drop your .csv manifest file anywhere to identify items that might get bonded.
              </p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-[#1A1A1A] text-white rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
              >
                Select CSV File
              </button>
            </div>
            
            <div className="bg-white border border-[#E5E5E5] rounded-3xl p-8 space-y-6">
              <div className="flex items-center gap-3 text-[#1A1A1A]">
                <Info size={20} />
                <h3 className="font-bold uppercase tracking-wider text-sm">Sample CSV Structure</h3>
              </div>
              <div className="bg-[#F9F9F9] p-4 rounded-xl font-mono text-[10px] text-[#666] overflow-x-auto whitespace-pre">
                HAWB,ConsigneeName,ConsigneeContactNo,UnitPrice,PackageDesc{"\n"}
                H123,John Doe,0123456789,750,iPhone 15 Pro{"\n"}
                H124,Jane Smith,0987654321,50,T-Shirt{"\n"}
                H125,John Doe,0123456789,120,Supplements
              </div>
              <div className="space-y-4 pt-4">
                <p className="text-xs text-[#666] leading-relaxed">
                  Your CSV must include these exact headers for the tool to work correctly.
                </p>
                <button 
                  onClick={() => {
                    const csv = "HAWB,ConsigneeName,ConsigneeContactNo,UnitPrice,PackageDesc\nH123,John Doe,0123456789,750,iPhone 15 Pro\nH124,Jane Smith,0987654321,50,T-Shirt\nH125,John Doe,0123456789,120,Supplements";
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'manifest_template.csv';
                    a.click();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 border border-[#E5E5E5] rounded-xl text-sm font-bold hover:bg-[#F9F9F9] transition-colors"
                >
                  <Download size={16} />
                  Download Template
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Flagged Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <h2 className="font-bold uppercase tracking-widest text-sm text-[#1A1A1A]">Potential Bonded Items ({selected.length})</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => exportToCSV(selected, 'flagged')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E5E5E5] rounded-lg text-xs font-bold hover:border-[#1A1A1A] transition-all"
                  >
                    <Upload size={14} className="rotate-180" />
                    EXPORT CSV
                  </button>
                  <button 
                    onClick={() => copyToClipboard(selected)}
                    disabled={selected.length === 0}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E5E5E5] rounded-lg text-xs font-bold hover:border-[#1A1A1A] transition-all disabled:opacity-50"
                  >
                    {copyStatus === 'copied' ? <CheckCircle2 size={14} className="text-green-600" /> : <Copy size={14} />}
                    {copyStatus === 'copied' ? 'COPIED' : 'COPY FOR SYSTEM'}
                  </button>
                </div>
              </div>

              <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#F9F9F9] border-bottom border-[#EEE]">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">HAWB</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Consignee Name</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Contact No</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Bonding Reasons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5F5F5]">
                      {selected.length > 0 ? selected.map((row, i) => (
                        <tr key={i} className="hover:bg-[#FFF9F9] transition-colors group">
                          <td className="px-4 py-3 text-sm font-mono font-medium text-[#1A1A1A]">{row.HAWB}</td>
                          <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                          <td className="px-4 py-3 text-sm text-[#666] font-mono">{row.ConsigneeContactNo}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.reasons.map(reason => (
                                <span 
                                  key={reason} 
                                  title={
                                    reason === 'Keyword' ? `Matched: ${row.matchedKeywords?.join(', ')}` : 
                                    reason === 'AI' ? `AI Reason: ${row.aiReason}` :
                                    undefined
                                  }
                                  className={cn(
                                    "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter cursor-help",
                                    reason === 'Price' ? "bg-red-100 text-red-700" :
                                    reason === 'Duplicate' ? "bg-purple-100 text-purple-700" :
                                    reason === 'Keyword' ? "bg-amber-100 text-amber-700" :
                                    reason === 'AI' ? "bg-blue-100 text-blue-700" :
                                    "bg-gray-100 text-gray-700"
                                  )}
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-12 text-center text-[#999] text-sm italic">No items identified for bonding.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Manual Check Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <h2 className="font-bold uppercase tracking-widest text-sm text-[#1A1A1A]">Manual Check ({notSelected.length})</h2>
                </div>
                <div className="flex items-center gap-2">
                  {settings.aiEnabled && (
                    <button 
                      onClick={runAiClassification}
                      disabled={isAiScanning || notSelected.length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 transition-all disabled:opacity-50"
                    >
                      {isAiScanning ? <RefreshCcw size={14} className="animate-spin" /> : <Brain size={14} />}
                      {isAiScanning ? 'SCANNING...' : 'AI SCAN'}
                    </button>
                  )}
                  <button 
                    onClick={() => exportToCSV(notSelected, 'manual_check')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E5E5E5] rounded-lg text-xs font-bold hover:border-[#1A1A1A] transition-all"
                  >
                    <Upload size={14} className="rotate-180" />
                    EXPORT CSV
                  </button>
                  <button 
                    onClick={() => setShowCheckedTable(!showCheckedTable)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all",
                      showCheckedTable ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#1A1A1A] border-[#E5E5E5] hover:border-[#1A1A1A]"
                    )}
                  >
                    <CheckCircle2 size={14} />
                    VIEW CHECKED ({checked.length})
                  </button>
                </div>
              </div>

              <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#F9F9F9] border-bottom border-[#EEE]">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">HAWB</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Consignee Name</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Contact No</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5F5F5]">
                      {notSelected.length > 0 ? notSelected.map((row, i) => (
                        <tr key={i} className="hover:bg-[#F9FFF9] transition-colors group">
                          <td 
                            className="px-4 py-3 text-sm font-mono text-[#666] cursor-pointer hover:text-[#1A1A1A] transition-colors"
                            onClick={() => setAuditItem(row)}
                            title="Click to Audit"
                          >
                            <div className="flex items-center gap-2">
                              {row.HAWB}
                              <Eye size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                          <td className="px-4 py-3 text-sm text-[#999] font-mono">{row.ConsigneeContactNo}</td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleManualFlag(row.HAWB);
                              }}
                              className="text-[10px] font-bold text-red-600 hover:underline"
                            >
                              FLAG
                            </button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-12 text-center text-[#999] text-sm italic">No items for manual check.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Checked Table (Hidden by default) */}
            <AnimatePresence>
              {showCheckedTable && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="lg:col-span-2 space-y-4 overflow-hidden"
                >
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <h2 className="font-bold uppercase tracking-widest text-sm text-[#1A1A1A]">Checked - Will Not Be Bonded ({checked.length})</h2>
                    </div>
                    <button 
                      onClick={() => exportToCSV(checked, 'checked')}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E5E5E5] rounded-lg text-xs font-bold hover:border-[#1A1A1A] transition-all"
                    >
                      <Upload size={14} className="rotate-180" />
                      EXPORT CSV
                    </button>
                  </div>

                  <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#F9F9F9] border-bottom border-[#EEE]">
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">HAWB</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Consignee Name</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999]">Contact No</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#999] text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F5F5F5]">
                          {checked.length > 0 ? checked.map((row, i) => (
                            <tr key={i} className="hover:bg-[#F9F9FF] transition-colors group">
                              <td className="px-4 py-3 text-sm font-mono text-[#666]">{row.HAWB}</td>
                              <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                              <td className="px-4 py-3 text-sm text-[#999] font-mono">{row.ConsigneeContactNo}</td>
                              <td className="px-4 py-3 text-right">
                                <button 
                                  onClick={() => {
                                    setCheckedHawbs(prev => {
                                      const next = new Set(prev);
                                      next.delete(row.HAWB);
                                      return next;
                                    });
                                  }}
                                  className="text-[10px] font-bold text-[#666] hover:text-[#1A1A1A] hover:underline"
                                >
                                  RESTORE
                                </button>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={4} className="px-4 py-12 text-center text-[#999] text-sm italic">No items marked as checked.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Audit Modal */}
      <AnimatePresence>
        {auditItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAuditItem(null)}
              className="absolute inset-0 bg-[#1A1A1A]/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl relative z-10"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#F5F5F5] rounded-xl flex items-center justify-center">
                      <Search size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold tracking-tight">Audit Item</h3>
                      <p className="text-xs text-[#666] font-mono">{auditItem.HAWB}</p>
                    </div>
                  </div>
                  <button onClick={() => setAuditItem(null)} className="p-2 hover:bg-[#F5F5F5] rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#999]">Consignee</p>
                    <p className="text-sm font-medium">{auditItem.ConsigneeName}</p>
                    <p className="text-xs text-[#666] font-mono">{auditItem.ConsigneeContactNo}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#999]">Package Description</p>
                    <div className="p-4 bg-[#F9F9F9] rounded-2xl border border-[#EEE] text-sm leading-relaxed">
                      {auditItem.PackageDesc}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 gap-4">
                    <div className="text-xs font-bold text-[#999]">
                      UNIT PRICE: <span className="text-[#1A1A1A] font-mono">${auditItem.UnitPrice}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => markAsChecked(auditItem.HAWB, true)}
                        className="px-6 py-2.5 bg-[#F5F5F5] text-[#1A1A1A] rounded-xl text-sm font-bold hover:bg-[#E5E5E5] transition-colors"
                      >
                        Will Not Be Bonded
                      </button>
                      <button 
                        onClick={() => toggleManualFlag(auditItem.HAWB, true)}
                        className="px-6 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                      >
                        Flag as Potential Bonding
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      {fileName && (
        <div className="fixed bottom-6 left-6 bg-[#1A1A1A] text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-3">
          <FileText size={14} />
          {fileName}
          <div className="w-px h-3 bg-white/20" />
          {data.length} TOTAL ROWS
        </div>
      )}
    </div>
  );
}

