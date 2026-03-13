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
  theme: 'default' | 'red-lava' | 'golden-day';
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
  theme: 'default',
};

// --- Components ---

export default function App() {
  const [data, setData] = useState<ManifestRow[]>([]);
  const [settings, setSettings] = useState<FilterSettings>(() => {
    const saved = localStorage.getItem('bonding_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch (e) {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
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
    
    // Apply theme to document root
    const root = document.documentElement;
    root.classList.remove('theme-red-lava', 'theme-golden-day');
    if (settings.theme === 'red-lava') {
      root.classList.add('theme-red-lava');
    } else if (settings.theme === 'golden-day') {
      root.classList.add('theme-golden-day');
    }
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
      className={cn(
        "min-h-screen selection:bg-accent-main selection:text-accent-text relative transition-colors duration-300"
      )}
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
            className="fixed inset-0 z-[100] bg-accent-main/90 backdrop-blur-sm flex flex-col items-center justify-center p-12 pointer-events-none"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="border-[length:calc(var(--border-w)*2)] border-dashed border-accent-text/30 rounded-[var(--radius-2xl)] w-full h-full flex flex-col items-center justify-center gap-6"
            >
              <div className="w-24 h-24 bg-bg-card rounded-[var(--radius-xl)] flex items-center justify-center text-text-main shadow-2xl">
                <Upload size={48} />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-accent-text tracking-tight">Drop Manifest to Screen</h2>
                <p className="text-accent-text/60 text-lg">Release to start processing the CSV file</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-bg-card border-b-[length:var(--border-w)] border-border-main px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent-main rounded-[var(--radius-md)] flex items-center justify-center text-accent-text">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Bonding Pre-Alert</h1>
            <p className="text-xs text-text-muted uppercase tracking-wider font-medium">Manifest Analysis Tool</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {data.length > 0 && (
            <button 
              onClick={resetManifest}
              className="flex items-center gap-2 px-4 py-2 text-danger-main hover:bg-danger-bg rounded-[var(--radius-sm)] transition-colors text-sm font-medium"
            >
              <RefreshCcw size={16} />
              Reset Manifest
            </button>
          )}
          
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border-[length:var(--border-w)] transition-all text-sm font-medium",
              isSettingsOpen ? "bg-accent-main text-accent-text border-accent-main" : "bg-bg-card text-text-main border-border-main hover:border-accent-main"
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
            className="flex items-center gap-2 px-4 py-2 bg-accent-main text-accent-text rounded-[var(--radius-sm)] hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm"
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
            className="bg-danger-bg border-[length:var(--border-w)] border-danger-main/30 text-danger-text px-4 py-3 rounded-[var(--radius-md)] flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={18} />
              <span className="text-sm font-medium">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="hover:bg-danger-bg p-1 rounded-[var(--radius-sm)]">
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
              <div className="bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-lg)] p-6 shadow-sm space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 size={20} />
                    <h2 className="text-lg font-bold tracking-tight">Bonding Rules & Configuration</h2>
                  </div>
                  <button 
                    onClick={resetToDefault}
                    className="flex items-center gap-2 text-xs font-bold text-text-main hover:underline"
                  >
                    <RefreshCcw size={14} />
                    RESET TO DEFAULT
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {/* Price Threshold */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-muted/70">Price Threshold (USD)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/70 text-sm">$</span>
                      <input 
                        type="number" 
                        value={settings.priceThreshold}
                        onChange={(e) => setSettings({ ...settings, priceThreshold: Number(e.target.value) })}
                        className="w-full pl-7 pr-4 py-2.5 bg-bg-subtle border-[length:var(--border-w)] border-border-main rounded-[var(--radius-md)] focus:outline-none focus:border-accent-main transition-colors font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-text-muted/70">Identify items exceeding this price for potential bonding pre-alert.</p>
                  </div>

                  {/* Keywords */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-muted/70">Bonding Keywords</label>
                    <div className="flex flex-wrap gap-2 p-3 bg-bg-subtle border-[length:var(--border-w)] border-border-main rounded-[var(--radius-md)] min-h-[46px]">
                      {settings.keywords.map((kw, i) => (
                        <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-sm)] text-xs font-medium">
                          {kw}
                          <button 
                            onClick={() => setSettings({ ...settings, keywords: settings.keywords.filter((_, idx) => idx !== i) })}
                            className="text-text-muted/70 hover:text-danger-main"
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
                    <p className="text-[10px] text-text-muted/70">Keywords used to identify items that might get bonded (matches PackageDesc).</p>
                  </div>

                  {/* AI Settings */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-text-muted/70">AI Classification (Gemini)</label>
                      <div 
                        onClick={() => setSettings({ ...settings, aiEnabled: !settings.aiEnabled })}
                        className={cn(
                          "w-10 h-5 rounded-full relative cursor-pointer transition-colors",
                          settings.aiEnabled ? "bg-success-main" : "bg-border-main"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-bg-card rounded-full transition-all",
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
                        className="w-full px-4 py-2.5 bg-bg-subtle border-[length:var(--border-w)] border-border-main rounded-[var(--radius-md)] focus:outline-none focus:border-accent-main transition-colors font-mono text-xs disabled:opacity-50"
                      />
                      <p className="text-[10px] text-text-muted/70">Required for intelligent PackageDesc analysis.</p>
                    </div>
                  </div>
                  {/* Theme Settings */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-muted/70">App Theme</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setSettings({ ...settings, theme: 'default' })}
                        className={cn(
                          "px-3 py-2 rounded-[var(--radius-md)] text-xs font-bold transition-all border",
                          settings.theme === 'default' 
                            ? "bg-accent-main text-accent-text border-accent-main" 
                            : "bg-bg-subtle text-text-muted border-border-main hover:border-accent-main"
                        )}
                      >
                        Default
                      </button>
                      <button
                        onClick={() => setSettings({ ...settings, theme: 'red-lava' })}
                        className={cn(
                          "px-3 py-2 rounded-[var(--radius-md)] text-xs font-bold transition-all border",
                          settings.theme === 'red-lava' 
                            ? "bg-danger-main text-white border-danger-main" 
                            : "bg-bg-subtle text-text-muted border-border-main hover:border-danger-main"
                        )}
                      >
                        Red Lava
                      </button>
                      <button
                        onClick={() => setSettings({ ...settings, theme: 'golden-day' })}
                        className={cn(
                          "px-3 py-2 rounded-[var(--radius-md)] text-xs font-bold transition-all border",
                          settings.theme === 'golden-day' 
                            ? "bg-[#D4AF37] text-black border-[#D4AF37]" 
                            : "bg-bg-subtle text-text-muted border-border-main hover:border-[#D4AF37]"
                        )}
                      >
                        Golden Day
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted/70">Select the visual appearance of the application.</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t-[length:var(--border-w)] border-border-main">
                  <input 
                    type="checkbox" 
                    id="dup-check"
                    checked={settings.checkDuplicates}
                    onChange={(e) => setSettings({ ...settings, checkDuplicates: e.target.checked })}
                    className="w-4 h-4 accent-accent-main"
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
            <div className="bg-bg-card p-5 rounded-[var(--radius-lg)] border-[length:var(--border-w)] border-border-main shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-bg text-danger-main rounded-[var(--radius-md)] flex items-center justify-center">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-text-muted/70 uppercase tracking-wider">Bonding Rate</p>
                <h3 className="text-2xl font-bold tracking-tight">{stats.percentage}%</h3>
                <p className="text-[10px] text-text-muted">{stats.flagged} of {stats.total} items flagged</p>
              </div>
            </div>
            <div className="bg-bg-card p-5 rounded-[var(--radius-lg)] border-[length:var(--border-w)] border-border-main shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-warning-bg text-warning-main rounded-[var(--radius-md)] flex items-center justify-center">
                <DollarSign size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-text-muted/70 uppercase tracking-wider">Potential Value</p>
                <h3 className="text-2xl font-bold tracking-tight">${stats.totalValue}</h3>
                <p className="text-[10px] text-text-muted">Total value of flagged items</p>
              </div>
            </div>
            <div className="bg-bg-card p-5 rounded-[var(--radius-lg)] border-[length:var(--border-w)] border-border-main shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-info-bg text-info-main rounded-[var(--radius-md)] flex items-center justify-center">
                <TrendingUp size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-text-muted/70 uppercase tracking-wider">Top Reason</p>
                <h3 className="text-2xl font-bold tracking-tight">{stats.topReason}</h3>
                <p className="text-[10px] text-text-muted">Most frequent bonding trigger</p>
              </div>
            </div>
            <div className="bg-bg-card p-5 rounded-[var(--radius-lg)] border-[length:var(--border-w)] border-border-main shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-info-bg text-blue-600 rounded-[var(--radius-md)] flex items-center justify-center">
                <Brain size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-text-muted/70 uppercase tracking-wider">AI Status</p>
                <h3 className="text-2xl font-bold tracking-tight">{settings.aiEnabled ? 'Active' : 'Disabled'}</h3>
                <p className="text-[10px] text-text-muted">{Object.keys(aiResults).length} AI detections</p>
              </div>
            </div>
          </div>
        )}

        {data.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div 
              className="lg:col-span-2 bg-bg-card border-[length:calc(var(--border-w)*2)] border-dashed border-border-main rounded-[var(--radius-xl)] h-[450px] flex flex-col items-center justify-center text-center p-12 transition-all"
            >
              <div className="w-16 h-16 bg-bg-subtle text-text-muted/40 rounded-[var(--radius-lg)] flex items-center justify-center mb-4 transition-colors">
                <Upload size={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Upload manifest for pre-alert</h3>
              <p className="text-text-muted max-w-md mb-8">
                Drag and drop your .csv manifest file anywhere to identify items that might get bonded.
              </p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-accent-main text-accent-text rounded-[var(--radius-md)] font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
              >
                Select CSV File
              </button>
            </div>
            
            <div className="bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-xl)] p-8 space-y-6">
              <div className="flex items-center gap-3 text-text-main">
                <Info size={20} />
                <h3 className="font-bold uppercase tracking-wider text-sm">Sample CSV Structure</h3>
              </div>
              <div className="bg-bg-subtle p-4 rounded-[var(--radius-md)] font-mono text-[10px] text-text-muted overflow-x-auto whitespace-pre">
                HAWB,ConsigneeName,ConsigneeContactNo,UnitPrice,PackageDesc{"\n"}
                H123,John Doe,0123456789,750,iPhone 15 Pro{"\n"}
                H124,Jane Smith,0987654321,50,T-Shirt{"\n"}
                H125,John Doe,0123456789,120,Supplements
              </div>
              <div className="space-y-4 pt-4">
                <p className="text-xs text-text-muted leading-relaxed">
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
                  className="w-full flex items-center justify-center gap-2 py-3 border-[length:var(--border-w)] border-border-main rounded-[var(--radius-md)] text-sm font-bold hover:bg-bg-subtle transition-colors"
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
                  <div className="w-2 h-2 rounded-full bg-danger-bg0 animate-pulse" />
                  <h2 className="font-bold uppercase tracking-widest text-sm text-text-main">Potential Bonded Items ({selected.length})</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => exportToCSV(selected, 'flagged')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-sm)] text-xs font-bold hover:border-accent-main transition-all"
                  >
                    <Upload size={14} className="rotate-180" />
                    EXPORT CSV
                  </button>
                  <button 
                    onClick={() => copyToClipboard(selected)}
                    disabled={selected.length === 0}
                    className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-sm)] text-xs font-bold hover:border-accent-main transition-all disabled:opacity-50"
                  >
                    {copyStatus === 'copied' ? <CheckCircle2 size={14} className="text-green-600" /> : <Copy size={14} />}
                    {copyStatus === 'copied' ? 'COPIED' : 'COPY FOR SYSTEM'}
                  </button>
                </div>
              </div>

              <div className="bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-lg)] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-bg-subtle border-bottom border-border-main">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">HAWB</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Consignee Name</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Contact No</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Bonding Reasons</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-main">
                      {selected.length > 0 ? selected.map((row, i) => (
                        <tr key={i} className="hover:bg-danger-bg/50 transition-colors group">
                          <td className="px-4 py-3 text-sm font-mono font-medium text-text-main">{row.HAWB}</td>
                          <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                          <td className="px-4 py-3 text-sm text-text-muted font-mono">{row.ConsigneeContactNo}</td>
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
                                    reason === 'Price' ? "bg-danger-bg text-danger-text" :
                                    reason === 'Duplicate' ? "bg-info-bg text-info-text" :
                                    reason === 'Keyword' ? "bg-warning-bg text-warning-text" :
                                    reason === 'AI' ? "bg-info-bg text-info-text" :
                                    "bg-bg-subtle text-text-muted"
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
                          <td colSpan={4} className="px-4 py-12 text-center text-text-muted/70 text-sm italic">No items identified for bonding.</td>
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
                  <div className="w-2 h-2 rounded-full bg-success-main" />
                  <h2 className="font-bold uppercase tracking-widest text-sm text-text-main">Manual Check ({notSelected.length})</h2>
                </div>
                <div className="flex items-center gap-2">
                  {settings.aiEnabled && (
                    <button 
                      onClick={runAiClassification}
                      disabled={isAiScanning || notSelected.length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 bg-info-bg text-info-text border-[length:var(--border-w)] border-blue-200 rounded-[var(--radius-sm)] text-xs font-bold hover:bg-info-bg transition-all disabled:opacity-50"
                    >
                      {isAiScanning ? <RefreshCcw size={14} className="animate-spin" /> : <Brain size={14} />}
                      {isAiScanning ? 'SCANNING...' : 'AI SCAN'}
                    </button>
                  )}
                  <button 
                    onClick={() => exportToCSV(notSelected, 'manual_check')}
                    className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-sm)] text-xs font-bold hover:border-accent-main transition-all"
                  >
                    <Upload size={14} className="rotate-180" />
                    EXPORT CSV
                  </button>
                  <button 
                    onClick={() => setShowCheckedTable(!showCheckedTable)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 border-[length:var(--border-w)] rounded-[var(--radius-sm)] text-xs font-bold transition-all",
                      showCheckedTable ? "bg-accent-main text-accent-text border-accent-main" : "bg-bg-card text-text-main border-border-main hover:border-accent-main"
                    )}
                  >
                    <CheckCircle2 size={14} />
                    VIEW CHECKED ({checked.length})
                  </button>
                </div>
              </div>

              <div className="bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-lg)] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-bg-subtle border-bottom border-border-main">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">HAWB</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Consignee Name</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Contact No</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-main">
                      {notSelected.length > 0 ? notSelected.map((row, i) => (
                        <tr key={i} className="hover:bg-success-bg/50 transition-colors group">
                          <td 
                            className="px-4 py-3 text-sm font-mono text-text-muted cursor-pointer hover:text-text-main transition-colors"
                            onClick={() => setAuditItem(row)}
                            title="Click to Audit"
                          >
                            <div className="flex items-center gap-2">
                              {row.HAWB}
                              <Eye size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                          <td className="px-4 py-3 text-sm text-text-muted/70 font-mono">{row.ConsigneeContactNo}</td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleManualFlag(row.HAWB);
                              }}
                              className="text-[10px] font-bold text-danger-main hover:underline"
                            >
                              FLAG
                            </button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-12 text-center text-text-muted/70 text-sm italic">No items for manual check.</td>
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
                      <div className="w-2 h-2 rounded-full bg-info-bg0" />
                      <h2 className="font-bold uppercase tracking-widest text-sm text-text-main">Checked - Will Not Be Bonded ({checked.length})</h2>
                    </div>
                    <button 
                      onClick={() => exportToCSV(checked, 'checked')}
                      className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-sm)] text-xs font-bold hover:border-accent-main transition-all"
                    >
                      <Upload size={14} className="rotate-180" />
                      EXPORT CSV
                    </button>
                  </div>

                  <div className="bg-bg-card border-[length:var(--border-w)] border-border-main rounded-[var(--radius-lg)] overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-bg-subtle border-bottom border-border-main">
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">HAWB</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Consignee Name</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70">Contact No</th>
                            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted/70 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-main">
                          {checked.length > 0 ? checked.map((row, i) => (
                            <tr key={i} className="hover:bg-info-bg/50 transition-colors group">
                              <td className="px-4 py-3 text-sm font-mono text-text-muted">{row.HAWB}</td>
                              <td className="px-4 py-3 text-sm font-medium">{row.ConsigneeName}</td>
                              <td className="px-4 py-3 text-sm text-text-muted/70 font-mono">{row.ConsigneeContactNo}</td>
                              <td className="px-4 py-3 text-right">
                                <button 
                                  onClick={() => {
                                    setCheckedHawbs(prev => {
                                      const next = new Set(prev);
                                      next.delete(row.HAWB);
                                      return next;
                                    });
                                  }}
                                  className="text-[10px] font-bold text-text-muted hover:text-text-main hover:underline"
                                >
                                  RESTORE
                                </button>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={4} className="px-4 py-12 text-center text-text-muted/70 text-sm italic">No items marked as checked.</td>
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
              className="absolute inset-0 bg-accent-main/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-bg-card rounded-[var(--radius-xl)] w-full max-w-lg overflow-hidden shadow-2xl relative z-10"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-bg-main rounded-[var(--radius-md)] flex items-center justify-center">
                      <Search size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold tracking-tight">Audit Item</h3>
                      <p className="text-xs text-text-muted font-mono">{auditItem.HAWB}</p>
                    </div>
                  </div>
                  <button onClick={() => setAuditItem(null)} className="p-2 hover:bg-bg-main rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted/70">Consignee</p>
                    <p className="text-sm font-medium">{auditItem.ConsigneeName}</p>
                    <p className="text-xs text-text-muted font-mono">{auditItem.ConsigneeContactNo}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted/70">Package Description</p>
                    <div className="p-4 bg-bg-subtle rounded-[var(--radius-lg)] border-[length:var(--border-w)] border-border-main text-sm leading-relaxed">
                      {auditItem.PackageDesc}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 gap-4">
                    <div className="text-xs font-bold text-text-muted/70">
                      UNIT PRICE: <span className="text-text-main font-mono">${auditItem.UnitPrice}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => markAsChecked(auditItem.HAWB, true)}
                        className="px-6 py-2.5 bg-bg-main text-text-main rounded-[var(--radius-md)] text-sm font-bold hover:bg-border-main transition-colors"
                      >
                        Will Not Be Bonded
                      </button>
                      <button 
                        onClick={() => toggleManualFlag(auditItem.HAWB, true)}
                        className="px-6 py-2.5 bg-danger-main text-white rounded-[var(--radius-md)] text-sm font-bold hover:bg-danger-main/80 transition-colors shadow-lg shadow-danger-main/20"
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
        <div className="fixed bottom-6 left-6 bg-accent-main text-accent-text px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-3">
          <FileText size={14} />
          {fileName}
          <div className="w-px h-3 bg-bg-card/20" />
          {data.length} TOTAL ROWS
        </div>
      )}
    </div>
  );
}

