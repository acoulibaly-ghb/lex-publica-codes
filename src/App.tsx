import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { Scale, Search, BookOpen, Info, Send, Loader2, Scale as ScaleIcon, ChevronRight, ExternalLink, Sun, Moon, Trash2, Plus, LogOut, LogIn, Star, FileText, Download, Upload, Gavel, Calendar, Tag, AlertCircle, Copy, Check, MessageSquare, Link } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { askLegalQuestion } from './services/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  deleteDoc,
  updateDoc,
  Timestamp
} from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Set worker path for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface LegalCode {
  id: string;
  userId: string;
  name: string;
  knowledgeBase: string;
  link?: string;
  createdAt: any;
  updatedAt: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isFavorite?: boolean;
}

interface FAQ {
  id: string;
  userId: string;
  question: string;
  answer: string;
  category: string;
  createdAt: any;
}

interface Jurisprudence {
  id: string;
  userId: string;
  title: string;
  date: string;
  summary: string;
  impact: 'Faible' | 'Moyen' | 'Fort' | 'Critique';
  tags: string[];
  link: string;
  fullAnalysis?: string;
  createdAt: any;
}

const IMPACT_COLORS = {
  Faible: 'bg-blue-100 text-blue-800 border-blue-200',
  Moyen: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Fort: 'bg-orange-100 text-orange-800 border-orange-200',
  Critique: 'bg-red-100 text-red-800 border-red-200',
};

const CATEGORIES = ['Droit Civil', 'Droit Pénal', 'Droit Social', 'Droit Public', 'Droit des Affaires'];

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Une erreur est survenue</h1>
            <p className="text-gray-600 mb-6">
              L'application a rencontré un problème inattendu. Veuillez rafraîchir la page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              Rafraîchir la page
            </button>
            {this.state.error && (
              <pre className="mt-6 p-4 bg-gray-100 rounded text-left text-xs text-gray-500 overflow-auto max-h-40">
                {typeof this.state.error === 'object' ? JSON.stringify(this.state.error, null, 2) : String(this.state.error)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTeachingMode, setIsTeachingMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'jurisprudence' | 'codes' | 'faq' | 'favorites'>('chat');
  const [favorites, setFavorites] = useState<Message[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [jurisprudence, setJurisprudence] = useState<Jurisprudence[]>([]);
  const [codes, setCodes] = useState<LegalCode[]>([]);
  const [jurisprudenceSearch, setJurisprudenceSearch] = useState('');
  const [codesSearch, setCodesSearch] = useState('');
  const [selectedJurisprudence, setSelectedJurisprudence] = useState<Jurisprudence | null>(null);
  const [selectedCode, setSelectedCode] = useState<LegalCode | null>(null);
  const [activeChatCodeId, setActiveChatCodeId] = useState<string>('');
  const [showAddJModal, setShowAddJModal] = useState(false);
  const [showAddCodeModal, setShowAddCodeModal] = useState(false);
  const [showAddFAQModal, setShowAddFAQModal] = useState(false);
  const [newJ, setNewJ] = useState<Partial<Jurisprudence>>({
    title: '',
    date: '',
    summary: '',
    impact: 'Moyen',
    tags: [],
    link: ''
  });
  const [newCode, setNewCode] = useState<Partial<LegalCode>>({
    name: '',
    knowledgeBase: '',
    link: ''
  });
  const [newFAQ, setNewFAQ] = useState<Partial<FAQ>>({
    question: '',
    answer: '',
    category: 'Droit Civil'
  });
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isCopying, setIsCopying] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, `users/${user.uid}/messages`), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date()
      })) as Message[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/messages`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, `users/${user.uid}/jurisprudence`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Jurisprudence[];
      setJurisprudence(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/jurisprudence`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, `users/${user.uid}/codes`), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as LegalCode[];
      setCodes(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/codes`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, `users/${user.uid}/faqs`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FAQ[];
      setFaqs(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/faqs`);
    });

    return () => unsubscribe();
  }, [user]);

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
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
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    // We don't throw here to avoid crashing the app, but we log it
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopying(id);
      setTimeout(() => setIsCopying(null), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setInput('');
    setIsLoading(true);

    try {
      await setDoc(doc(db, `users/${user.uid}/messages`, userMessage.id), {
        ...userMessage,
        timestamp: serverTimestamp()
      });

      const history = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const activeCode = codes.find(c => c.id === activeChatCodeId);

      const response = await askLegalQuestion(
        input, 
        history as any, 
        isTeachingMode, 
        activeCode?.knowledgeBase,
        activeCode?.link,
        activeCode?.name
      );

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text,
        timestamp: new Date()
      };

      await setDoc(doc(db, `users/${user.uid}/messages`, assistantMessage.id), {
        ...assistantMessage,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Désolé, une erreur est survenue lors de la communication avec l'IA. Veuillez réessayer.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddJurisprudence = async () => {
    if (!user || !newJ.title || !newJ.date) return;

    try {
      const jRef = doc(collection(db, `users/${user.uid}/jurisprudence`));
      const jData: Jurisprudence = {
        id: jRef.id,
        userId: user.uid,
        title: newJ.title!,
        date: newJ.date!,
        summary: newJ.summary || '',
        impact: (newJ.impact as any) || 'Moyen',
        tags: newJ.tags || [],
        link: newJ.link || '',
        createdAt: serverTimestamp()
      };

      await setDoc(jRef, jData);
      setShowAddJModal(false);
      setNewJ({
        title: '',
        date: '',
        summary: '',
        impact: 'Moyen',
        tags: [],
        link: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/jurisprudence`);
    }
  };

  const handleAddCode = async () => {
    if (!user || !newCode.name) return;

    try {
      const codeRef = doc(collection(db, `users/${user.uid}/codes`));
      const codeData: LegalCode = {
        id: codeRef.id,
        userId: user.uid,
        name: newCode.name!,
        knowledgeBase: newCode.knowledgeBase || '',
        link: newCode.link || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(codeRef, codeData);
      setShowAddCodeModal(false);
      setNewCode({
        name: '',
        knowledgeBase: '',
        link: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/codes`);
    }
  };

  const handleDeleteJurisprudence = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/jurisprudence`, id));
      if (selectedJurisprudence?.id === id) setSelectedJurisprudence(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/jurisprudence`);
    }
  };

  const handleDeleteCode = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/codes`, id));
      if (selectedCode?.id === id) setSelectedCode(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/codes`);
    }
  };

  const handleAddFAQ = async () => {
    if (!user || !newFAQ.question || !newFAQ.answer) return;

    try {
      const faqRef = doc(collection(db, `users/${user.uid}/faqs`));
      const faqData: FAQ = {
        id: faqRef.id,
        userId: user.uid,
        question: newFAQ.question!,
        answer: newFAQ.answer!,
        category: newFAQ.category || 'Droit Civil',
        createdAt: serverTimestamp()
      };

      await setDoc(faqRef, faqData);
      setShowAddFAQModal(false);
      setNewFAQ({
        question: '',
        answer: '',
        category: 'Droit Civil'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/faqs`);
    }
  };

  const handleDeleteFAQ = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/faqs`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/faqs`);
    }
  };

  const generateFullAnalysis = async (j: Jurisprudence) => {
    if (!user || isLoading) return;
    setIsLoading(true);

    try {
      const prompt = `En tant qu'expert juridique et pédagogue, génère une analyse complète et structurée de la jurisprudence suivante :
      
      TITRE : ${j.title}
      DATE : ${j.date}
      RÉSUMÉ : ${j.summary}
      IMPACT : ${j.impact}
      TAGS : ${j.tags.join(', ')}
      
      L'analyse doit impérativement suivre ce plan pédagogique détaillé :
      
      # FICHE D'ARRÊT PÉDAGOGIQUE
      
      ## 1. Faits et Procédure
      (Explique clairement les faits à l'origine du litige et le parcours judiciaire de l'affaire)
      
      ## 2. Prétentions des Parties
      (Détaille les arguments de chaque partie)
      
      ## 3. Question de Droit
      (Formule la problématique juridique centrale de manière claire et concise)
      
      ## 4. Solution de la Cour
      (Explique la décision rendue et le raisonnement juridique suivi)
      
      ## 5. Portée et Analyse Pédagogique
      (Analyse l'impact de cette décision sur le droit positif, son importance pour les étudiants et les points clés à retenir)
      
      Utilise un ton professionnel, didactique et précis. Utilise le format Markdown pour la structure.`;

      const response = await askLegalQuestion(prompt, [], true);
      
      await updateDoc(doc(db, `users/${user.uid}/jurisprudence`, j.id), {
        fullAnalysis: response.text
      });
      
      setSelectedJurisprudence({ ...j, fullAnalysis: response.text });
    } catch (error) {
      console.error('Error generating analysis:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendToChat = async (analysis: string) => {
    if (!user) return;
    try {
      const msgId = Date.now().toString();
      await setDoc(doc(db, `users/${user.uid}/messages`, msgId), {
        id: msgId,
        role: 'assistant',
        content: analysis,
        timestamp: serverTimestamp()
      });
      setActiveTab('chat');
    } catch (error) {
      console.error('Error sending to chat:', error);
    }
  };

  const handleSendCodeContextToChat = (codeId: string) => {
    setActiveChatCodeId(codeId);
    setSelectedCode(null);
    setActiveTab('chat');
  };

  const toggleFavoriteMessage = async (message: Message) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/messages`, message.id), {
        isFavorite: !message.isFavorite
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/messages`);
    }
  };

  const exportToPDF = async (message: Message) => {
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (2 * margin);
    
    doc.setFontSize(16);
    doc.text('LexAdmin - Export de Message', margin, 20);
    
    doc.setFontSize(10);
    doc.text(`Date: ${message.timestamp.toLocaleString()}`, margin, 30);
    doc.text(`Rôle: ${message.role === 'user' ? 'Utilisateur' : 'Assistant LexAdmin'}`, margin, 35);
    
    doc.setLineWidth(0.5);
    doc.line(margin, 40, pageWidth - margin, 40);
    
    doc.setFontSize(12);
    const splitText = doc.splitTextToSize(message.content, contentWidth);
    doc.text(splitText, margin, 50);
    
    doc.save(`lexadmin-message-${message.id}.pdf`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsLoading(true);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item: any) => item.str).join(' ') + '\n';
        }
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else {
        text = await file.text();
      }

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: `Analyse de document (${file.name}) :\n\n${text.slice(0, 5000)}...`,
        timestamp: new Date()
      };

      await setDoc(doc(db, `users/${user.uid}/messages`, userMessage.id), {
        ...userMessage,
        timestamp: serverTimestamp()
      });

      const response = await askLegalQuestion(`Voici le contenu d'un document nommé "${file.name}". Peux-tu m'en faire un résumé et analyser les points juridiques clés ?\n\n${text.slice(0, 10000)}`, [], isTeachingMode);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text,
        timestamp: new Date()
      };

      await setDoc(doc(db, `users/${user.uid}/messages`, assistantMessage.id), {
        ...assistantMessage,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Scale size={40} />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">LexAdmin</h1>
          <p className="text-gray-600 mb-8">Votre assistant juridique intelligent pour une gestion simplifiée et pédagogique.</p>
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors text-gray-700 font-medium shadow-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pjax_loader.gif" alt="" className="w-5 h-5 hidden" />
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/>
            </svg>
            Continuer avec Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-screen bg-gray-50", darkMode && "dark")}>
      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col",
        showSidebar ? "w-64" : "w-0 overflow-hidden border-none"
      )}>
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Scale size={24} />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">LexAdmin</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('chat')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === 'chat' ? "bg-emerald-50 text-emerald-700 font-medium shadow-sm" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <MessageSquare size={20} />
            Assistant IA
          </button>
          <button
            onClick={() => setActiveTab('jurisprudence')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === 'jurisprudence' ? "bg-emerald-50 text-emerald-700 font-medium shadow-sm" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <Gavel size={20} />
            Veille Jurisprudentielle
          </button>
          <button
            onClick={() => setActiveTab('codes')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === 'codes' ? "bg-emerald-50 text-emerald-700 font-medium shadow-sm" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <BookOpen size={20} />
            Mes Codes
          </button>
          <button
            onClick={() => setActiveTab('faq')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === 'faq' ? "bg-emerald-50 text-emerald-700 font-medium shadow-sm" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <BookOpen size={20} />
            Base de Connaissances
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
              activeTab === 'favorites' ? "bg-emerald-50 text-emerald-700 font-medium shadow-sm" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <Star size={20} />
            Favoris
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-4">
            <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user.displayName}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200"
          >
            <LogOut size={18} />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-gray-100 flex items-center justify-between px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
            >
              <ChevronRight className={cn("transition-transform duration-300", showSidebar && "rotate-180")} />
            </button>
            <h2 className="text-lg font-semibold text-gray-900 capitalize">
              {activeTab === 'chat' ? 'Assistant IA Juridique' : activeTab === 'jurisprudence' ? 'Veille Jurisprudentielle' : activeTab === 'codes' ? 'Mes Codes' : activeTab === 'faq' ? 'Base de Connaissances' : 'Messages Favoris'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {activeTab === 'chat' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
                <div className={cn("w-2 h-2 rounded-full", isTeachingMode ? "bg-emerald-500 animate-pulse" : "bg-gray-400")} />
                <span className="text-xs font-medium text-emerald-700">Mode Pédagogique</span>
                <button
                  onClick={() => setIsTeachingMode(!isTeachingMode)}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                    isTeachingMode ? "bg-emerald-600" : "bg-gray-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                    isTeachingMode ? "translate-x-5" : "translate-x-1"
                  )} />
                </button>
              </div>
            )}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden relative flex flex-col">
          {activeTab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
                      <Scale size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Bienvenue sur LexAdmin</h3>
                    <p className="text-gray-600">
                      Posez vos questions juridiques, téléchargez des documents pour analyse, ou explorez la veille jurisprudentielle.
                    </p>
                    <div className="grid grid-cols-2 gap-4 mt-8 w-full">
                      {[
                        "Qu'est-ce qu'un CDI ?",
                        "Analyse cet arrêt...",
                        "Droit de la famille",
                        "Procédure civile"
                      ].map((hint) => (
                        <button
                          key={hint}
                          onClick={() => setInput(hint)}
                          className="p-3 text-sm text-gray-600 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 rounded-xl border border-gray-100 transition-all text-left"
                        >
                          {hint}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "flex gap-4 max-w-4xl",
                        message.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 shadow-sm",
                        message.role === 'user' ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-emerald-600"
                      )}>
                        {message.role === 'user' ? <Info size={16} /> : <ScaleIcon size={16} />}
                      </div>
                      <div className={cn(
                        "flex flex-col gap-2",
                        message.role === 'user' ? "items-end" : "items-start"
                      )}>
                        <div className={cn(
                          "px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed",
                          message.role === 'user' 
                            ? "bg-emerald-600 text-white rounded-tr-none" 
                            : "bg-white border border-gray-100 text-gray-800 rounded-tl-none"
                        )}>
                          <div className="markdown-body">
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 px-1">
                          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {message.role === 'assistant' && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => copyToClipboard(message.content, message.id)}
                                className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-400 hover:text-emerald-600"
                                title="Copier"
                              >
                                {isCopying === message.id ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                              <button
                                onClick={() => toggleFavoriteMessage(message)}
                                className={cn(
                                  "p-1 hover:bg-gray-100 rounded transition-colors",
                                  message.isFavorite ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"
                                )}
                                title="Favoris"
                              >
                                <Star size={14} fill={message.isFavorite ? "currentColor" : "none"} />
                              </button>
                              <button
                                onClick={() => exportToPDF(message)}
                                className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-400 hover:text-emerald-600"
                                title="Exporter en PDF"
                              >
                                <FileText size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-6 bg-white border-t border-gray-100">
                <div className="max-w-4xl mx-auto mb-3 flex items-center justify-end gap-2">
                  <div className="text-xs text-gray-500 font-medium">Source interrogée :</div>
                  <select
                    value={activeChatCodeId}
                    onChange={(e) => setActiveChatCodeId(e.target.value)}
                    className="text-xs bg-gray-50 border border-gray-200 text-gray-700 rounded-lg px-2 py-1.5 focus:ring-emerald-500 focus:border-emerald-500 max-w-[250px] truncate"
                  >
                    <option value="">Aucune (Générale)</option>
                    {codes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
                  <div className="relative flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-2 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 transition-all shadow-sm">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2.5 text-gray-400 hover:text-emerald-600 hover:bg-white rounded-xl transition-all"
                      title="Télécharger un document"
                    >
                      <Upload size={20} />
                    </button>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      placeholder="Posez votre question juridique ici..."
                      className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2.5 px-2 resize-none max-h-40 min-h-[44px]"
                      rows={1}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className={cn(
                        "p-2.5 rounded-xl transition-all shadow-md",
                        !input.trim() || isLoading 
                          ? "bg-gray-200 text-gray-400 cursor-not-allowed" 
                          : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200"
                      )}
                    >
                      {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt"
                  />
                  <p className="text-[10px] text-gray-400 mt-3 text-center uppercase tracking-widest font-medium">
                    LexAdmin peut faire des erreurs. Vérifiez les informations importantes.
                  </p>
                </form>
              </div>
            </>
          )}

          {activeTab === 'jurisprudence' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">Veille Jurisprudentielle</h3>
                    <p className="text-gray-600">Suivez et analysez les dernières décisions de justice.</p>
                  </div>
                  <button
                    onClick={() => setShowAddJModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100"
                  >
                    <Plus size={20} />
                    Ajouter une décision
                  </button>
                </div>

                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Rechercher par titre, résumé ou mots-clés..."
                    value={jurisprudenceSearch}
                    onChange={(e) => setJurisprudenceSearch(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all shadow-sm"
                  />
                </div>

                <div className="grid gap-4">
                  {jurisprudence
                    .filter(j => 
                      j.title.toLowerCase().includes(jurisprudenceSearch.toLowerCase()) ||
                      j.summary.toLowerCase().includes(jurisprudenceSearch.toLowerCase()) ||
                      j.tags.some(t => t.toLowerCase().includes(jurisprudenceSearch.toLowerCase()))
                    )
                    .map((j) => (
                      <div key={j.id} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-all group">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className={cn(
                                "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                                IMPACT_COLORS[j.impact]
                              )}>
                                Impact {j.impact}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Calendar size={12} />
                                {j.date}
                              </span>
                            </div>
                            <h4 className="text-lg font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">{j.title}</h4>
                          </div>
                          <button
                            onClick={() => handleDeleteJurisprudence(j.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        
                        <div className="relative mb-4">
                          <p className="text-sm text-gray-600 leading-relaxed pr-8 line-clamp-3">{j.summary}</p>
                          <button
                            onClick={() => copyToClipboard(j.summary, j.id)}
                            className="absolute right-0 top-0 p-1.5 text-gray-400 hover:text-emerald-600 transition-colors"
                            title="Copier le résumé"
                          >
                            {isCopying === j.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-2 mb-6">
                          {j.tags.map(tag => (
                            <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-gray-50 text-gray-500 rounded-lg text-xs font-medium border border-gray-100">
                              <Tag size={10} />
                              {tag}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setSelectedJurisprudence(j)}
                              className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 group/btn"
                            >
                              Consulter l'analyse complète
                              <ChevronRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                            {j.link && (
                              <a
                                href={j.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-gray-400 hover:text-emerald-600 flex items-center gap-1"
                              >
                                <ExternalLink size={14} />
                                Légifrance
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'codes' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">Mes Codes</h3>
                    <p className="text-gray-600">Gérez vos codes juridiques et bases de connaissances personnalisées.</p>
                  </div>
                  <button
                    onClick={() => setShowAddCodeModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100"
                  >
                    <Plus size={20} />
                    Ajouter un code
                  </button>
                </div>

                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Rechercher un code..."
                    value={codesSearch}
                    onChange={(e) => setCodesSearch(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all shadow-sm"
                  />
                </div>

                <div className="grid gap-4">
                  {codes
                    .filter(c => c.name.toLowerCase().includes(codesSearch.toLowerCase()))
                    .map((c) => (
                      <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-all group">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h4 className="text-lg font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">{c.name}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <p className="text-sm text-gray-400">Dernière mise à jour : {c.updatedAt?.toDate().toLocaleDateString()}</p>
                              {c.link && (
                                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                                  <Link size={10} />
                                  Légifrance
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteCode(c.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        
                        <p className="text-sm text-gray-600 leading-relaxed line-clamp-2 mb-4">
                          {c.knowledgeBase || "Aucune base de connaissances définie."}
                        </p>

                        <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                          <button
                            onClick={() => setSelectedCode(c)}
                            className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 group/btn"
                          >
                            Consulter le contenu
                            <ChevronRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'faq' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">Base de Connaissances</h3>
                    <p className="text-gray-600">Consultez et gérez vos fiches juridiques et questions fréquentes.</p>
                  </div>
                  <button
                    onClick={() => setShowAddFAQModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100"
                  >
                    <Plus size={20} />
                    Ajouter une fiche
                  </button>
                </div>

                <div className="grid gap-6">
                  {CATEGORIES.map(category => {
                    const categoryFaqs = faqs.filter(f => f.category === category);
                    if (categoryFaqs.length === 0) return null;
                    
                    return (
                      <div key={category} className="space-y-4">
                        <h4 className="text-sm font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                          <div className="w-1 h-4 bg-emerald-600 rounded-full" />
                          {category}
                        </h4>
                        <div className="grid gap-4">
                          {categoryFaqs.map(faq => (
                            <div key={faq.id} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-all group">
                              <div className="flex justify-between items-start gap-4 mb-4">
                                <h5 className="text-lg font-bold text-gray-900">{faq.question}</h5>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => copyToClipboard(faq.answer, faq.id)}
                                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                    title="Copier la réponse"
                                  >
                                    {isCopying === faq.id ? <Check size={18} /> : <Copy size={18} />}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteFAQ(faq.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    title="Supprimer la fiche"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </div>
                              </div>
                              <div className="text-sm text-gray-600 leading-relaxed markdown-body">
                                <ReactMarkdown>{faq.answer}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {faqs.length === 0 && (
                    <div className="text-center py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                      <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500 font-medium">Votre base de connaissances est vide.</p>
                      <button
                        onClick={() => setShowAddFAQModal(true)}
                        className="mt-4 text-emerald-600 font-bold hover:text-emerald-700"
                      >
                        Ajouter votre première fiche
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'favorites' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl mx-auto">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold text-gray-900">Messages Favoris</h3>
                  <p className="text-gray-600">Retrouvez ici tous les messages que vous avez marqués comme importants.</p>
                </div>

                <div className="space-y-6">
                  {messages.filter(m => m.isFavorite).length === 0 ? (
                    <div className="text-center py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                      <Star size={48} className="mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">Aucun message favori pour le moment.</p>
                    </div>
                  ) : (
                    messages.filter(m => m.isFavorite).map(message => (
                      <div key={message.id} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm relative group">
                        <div className="flex items-center gap-3 mb-4">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shadow-sm",
                            message.role === 'user' ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-600"
                          )}>
                            {message.role === 'user' ? <Info size={16} /> : <ScaleIcon size={16} />}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                              {message.role === 'user' ? 'Votre question' : 'Réponse LexAdmin'}
                            </p>
                            <p className="text-[10px] text-gray-400">
                              {message.timestamp.toLocaleString()}
                            </p>
                          </div>
                          <div className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => copyToClipboard(message.content, message.id)}
                              className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-gray-50 rounded-lg transition-all"
                            >
                              {isCopying === message.id ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <button
                              onClick={() => toggleFavoriteMessage(message)}
                              className="p-2 text-yellow-500 hover:bg-yellow-50 rounded-lg transition-all"
                            >
                              <Star size={16} fill="currentColor" />
                            </button>
                            <button
                              onClick={() => exportToPDF(message)}
                              className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-gray-50 rounded-lg transition-all"
                            >
                              <FileText size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="text-sm text-gray-700 leading-relaxed markdown-body">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Add FAQ Modal */}
        {showAddFAQModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-gray-900">Ajouter une fiche</h3>
                <button onClick={() => setShowAddFAQModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Plus size={24} className="rotate-45 text-gray-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Catégorie</label>
                  <select
                    value={newFAQ.category}
                    onChange={(e) => setNewFAQ({ ...newFAQ, category: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Question / Titre</label>
                  <input
                    type="text"
                    placeholder="ex: Qu'est-ce qu'un CDI ?"
                    value={newFAQ.question}
                    onChange={(e) => setNewFAQ({ ...newFAQ, question: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Réponse / Contenu</label>
                  <textarea
                    placeholder="Détaillez la réponse ou le contenu de la fiche..."
                    value={newFAQ.answer}
                    onChange={(e) => setNewFAQ({ ...newFAQ, answer: e.target.value })}
                    rows={8}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all resize-none"
                  />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3">
                <button
                  onClick={() => setShowAddFAQModal(false)}
                  className="flex-1 py-3 px-4 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddFAQ}
                  disabled={!newFAQ.question || !newFAQ.answer}
                  className="flex-1 py-3 px-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Enregistrer la fiche
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Jurisprudence Modal */}
        {showAddJModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-gray-900">Ajouter une décision</h3>
                <button onClick={() => setShowAddJModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Plus size={24} className="rotate-45 text-gray-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Titre de la décision</label>
                    <input
                      type="text"
                      placeholder="ex: Arrêt Perruche"
                      value={newJ.title}
                      onChange={(e) => setNewJ({ ...newJ, title: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Date</label>
                    <input
                      type="date"
                      value={newJ.date}
                      onChange={(e) => setNewJ({ ...newJ, date: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Résumé des faits</label>
                  <textarea
                    placeholder="Décrivez brièvement les faits et la portée de l'arrêt..."
                    value={newJ.summary}
                    onChange={(e) => setNewJ({ ...newJ, summary: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Impact juridique</label>
                    <select
                      value={newJ.impact}
                      onChange={(e) => setNewJ({ ...newJ, impact: e.target.value as any })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                    >
                      <option value="Faible">Faible</option>
                      <option value="Moyen">Moyen</option>
                      <option value="Fort">Fort</option>
                      <option value="Critique">Critique</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Lien Légifrance</label>
                    <input
                      type="url"
                      placeholder="https://www.legifrance.gouv.fr/..."
                      value={newJ.link}
                      onChange={(e) => setNewJ({ ...newJ, link: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Mots-clés (séparés par des virgules)</label>
                  <input
                    type="text"
                    placeholder="ex: Responsabilité civile, Préjudice, Naissance"
                    value={newJ.tags?.join(', ')}
                    onChange={(e) => setNewJ({ ...newJ, tags: e.target.value.split(',').map(t => t.trim()).filter(t => t) })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                  />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3">
                <button
                  onClick={() => setShowAddJModal(false)}
                  className="flex-1 py-3 px-4 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddJurisprudence}
                  disabled={!newJ.title || !newJ.date}
                  className="flex-1 py-3 px-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Enregistrer la décision
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Code Modal */}
        {showAddCodeModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-xl font-bold text-gray-900">Ajouter un code</h3>
                <button onClick={() => setShowAddCodeModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Plus size={24} className="rotate-45 text-gray-400" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Nom du code</label>
                  <input
                    type="text"
                    placeholder="ex: Code Civil"
                    value={newCode.name}
                    onChange={(e) => setNewCode({ ...newCode, name: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Lien Légifrance (Optionnel)</label>
                  <input
                    type="url"
                    placeholder="https://www.legifrance.gouv.fr/codes/id/..."
                    value={newCode.link}
                    onChange={(e) => setNewCode({ ...newCode, link: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 uppercase tracking-wider">Base de connaissances / Annotations (Optionnel)</label>
                  <textarea
                    placeholder="Collez ici le contenu du code ou vos annotations personnelles..."
                    value={newCode.knowledgeBase}
                    onChange={(e) => setNewCode({ ...newCode, knowledgeBase: e.target.value })}
                    rows={8}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-100 focus:border-emerald-500 transition-all resize-none"
                  />
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex gap-3">
                <button
                  onClick={() => setShowAddCodeModal(false)}
                  className="flex-1 py-3 px-4 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddCode}
                  disabled={!newCode.name}
                  className="flex-1 py-3 px-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Enregistrer le code
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Code Detail Modal */}
        {selectedCode && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedCode.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-gray-400 font-medium">Mis à jour le {selectedCode.updatedAt?.toDate().toLocaleDateString()}</p>
                    {selectedCode.link && (
                      <a
                        href={selectedCode.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-medium"
                      >
                        <ExternalLink size={12} />
                        Légifrance
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(selectedCode.knowledgeBase || selectedCode.link || selectedCode.name, selectedCode.id)}
                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                    title="Copier le contenu"
                  >
                    {isCopying === selectedCode.id ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                  <button
                    onClick={() => handleSendCodeContextToChat(selectedCode.id)}
                    className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                    title="Interroger dans le chat"
                  >
                    <MessageSquare size={20} />
                  </button>
                  <button onClick={() => setSelectedCode(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-2">
                    <Plus size={24} className="rotate-45 text-gray-400" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                {selectedCode.knowledgeBase ? (
                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {selectedCode.knowledgeBase}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 italic flex flex-col items-center justify-center p-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                    <p className="font-medium text-gray-700 mb-2">Aucune base de connaissances locale.</p>
                    <p className="text-center">Ce code ne contient que le lien Légifrance. Utilisez l'icône "Bulle" en haut à droite pour l'interroger directement dans le chat.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Jurisprudence Detail Modal */}
        {selectedJurisprudence && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      IMPACT_COLORS[selectedJurisprudence.impact]
                    )}>
                      Impact {selectedJurisprudence.impact}
                    </span>
                    <span className="text-xs text-gray-400 font-medium">{selectedJurisprudence.date}</span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedJurisprudence.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {selectedJurisprudence.fullAnalysis && (
                    <>
                      <button
                        onClick={() => copyToClipboard(selectedJurisprudence.fullAnalysis!, selectedJurisprudence.id)}
                        className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Copier l'analyse"
                      >
                        {isCopying === selectedJurisprudence.id ? <Check size={20} /> : <Copy size={20} />}
                      </button>
                      <button
                        onClick={() => handleSendToChat(selectedJurisprudence.fullAnalysis!)}
                        className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Envoyer vers le chat"
                      >
                        <MessageSquare size={20} />
                      </button>
                    </>
                  )}
                  <button onClick={() => setSelectedJurisprudence(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-2">
                    <Plus size={24} className="rotate-45 text-gray-400" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                {!selectedJurisprudence.fullAnalysis ? (
                  <div className="text-center py-20">
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                      <Gavel size={40} />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-2">Analyse Pédagogique non générée</h4>
                    <p className="text-gray-600 mb-8 max-w-md mx-auto">
                      L'IA LexAdmin peut générer une fiche d'arrêt complète et pédagogique pour cette décision.
                    </p>
                    <button
                      onClick={() => generateFullAnalysis(selectedJurisprudence)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-2 px-8 py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 disabled:opacity-50"
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <Scale size={20} />}
                      Générer l'analyse complète
                    </button>
                  </div>
                ) : (
                  <div className="markdown-body prose prose-emerald max-w-none">
                    <ReactMarkdown>{selectedJurisprudence.fullAnalysis}</ReactMarkdown>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {selectedJurisprudence.tags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-white text-gray-500 rounded-lg text-xs font-bold border border-gray-200">
                      #{tag}
                    </span>
                  ))}
                </div>
                {selectedJurisprudence.link && (
                  <a
                    href={selectedJurisprudence.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-all text-sm font-bold"
                  >
                    <ExternalLink size={16} />
                    Voir sur Légifrance
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
