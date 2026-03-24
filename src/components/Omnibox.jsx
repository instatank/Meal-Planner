import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2, X, Check } from 'lucide-react';
import { parseMealIntent, isGeminiConfigured } from '../lib/geminiService';
import { mealDatabase } from '../data/mealDatabase';

const Omnibox = ({ onAIAction, disabled = false, activeContext, onClearContext, onRequestContext, externalInputRef, prefill = "", onClearPrefill, systemConfig = null }) => {
    const [input, setInput] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pendingIntent, setPendingIntent] = useState(null);
    const [isFocused, setIsFocused] = useState(false);
    const internalInputRef = useRef(null);
    const inputRef = externalInputRef || internalInputRef;

    const isConfigured = isGeminiConfigured();

    useEffect(() => {
        if (prefill) {
            setInput(prefill);
            if (onClearPrefill) onClearPrefill();
        }
    }, [prefill, onClearPrefill]);

    useEffect(() => {
        if (!input.trim() || input.trim().length < 2) {
            setSuggestions([]);
            return;
        }

        const lowerInput = input.trim().toLowerCase();
        const results = [];
        const activeDb = systemConfig?.meals || mealDatabase;

        for (const [slot, meals] of Object.entries(activeDb)) {
            for (const m of meals) {
                if (
                    m.name.toLowerCase().includes(lowerInput) ||
                    m.display_name.toLowerCase().includes(lowerInput) ||
                    m.canonical_name.toLowerCase().includes(lowerInput)
                ) {
                    if (!results.some(existing => existing.canonical_name === m.canonical_name)) {
                        results.push({ ...m, matchedSlot: slot === 'lunchDinner' ? 'lunch_dinner' : slot });
                    }
                }
            }
        }

        setSuggestions(results.slice(0, 5));
    }, [input]);

    const handleSuggestionClick = (meal) => {
        onAIAction({
            intent: 'ADD_DB_MEAL',
            slot: meal.matchedSlot,
            data: meal
        });
        setInput('');
        setSuggestions([]);
        setShowSuggestions(false);
    };

    const handleProcessIntent = async (e) => {
        e.preventDefault();
        if (!input.trim() || disabled || !isConfigured || loading) return;

        setLoading(true);
        setError(null);
        setPendingIntent(null);

        const lowerInput = input.trim().toLowerCase();
        let matchedMeal = null;
        let matchedSlot = null;
        const activeDb = systemConfig?.meals || mealDatabase;

        for (const [slot, meals] of Object.entries(activeDb)) {
            const found = meals.find(m =>
                m.canonical_name.toLowerCase() === lowerInput ||
                m.name.toLowerCase() === lowerInput ||
                m.display_name.toLowerCase() === lowerInput
            );
            if (found) {
                matchedMeal = found;
                matchedSlot = slot === 'lunchDinner' ? 'lunch_dinner' : slot;
                break;
            }
        }

        if (matchedMeal) {
            onAIAction({
                intent: 'ADD_DB_MEAL',
                slot: matchedSlot,
                data: matchedMeal
            });
            setInput('');
            setLoading(false);
            return;
        }

        try {
            const intentPayload = await parseMealIntent(input, activeContext, systemConfig);
            setPendingIntent(intentPayload);
            setInput(''); // Clear input after successful parse
        } catch (err) {
            setError("I couldn't quite understand that. Try formatting it like: 'I had 3 eggs and toast for breakfast'");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmIntent = () => {
        if (pendingIntent) {
            onAIAction(pendingIntent);
            setPendingIntent(null);
        }
    };

    const handleCancelIntent = () => {
        setPendingIntent(null);
        // Optionally focus input again
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    if (!isConfigured) {
        return (
            <div className="w-full bg-red-50 text-red-600 rounded-xl p-4 text-sm mt-6 border border-red-200">
                <p className="font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Omnibox Disabled
                </p>
                <p className="mt-1 opacity-80">
                    Missing VITE_GEMINI_API_KEY in .env.local
                </p>
            </div>
        );
    }

    return (
        <div className="w-full mt-1 mb-2">

            {/* Pending Confirmation Card */}
            {pendingIntent && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h4 className="font-semibold text-emerald-900 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 shrink-0" />
                                Understood!
                            </h4>
                            <p className="text-emerald-800 text-sm mt-1">
                                {pendingIntent.intent === 'ADD_CUSTOM' && `Log: ${pendingIntent.data.name}`}
                                {pendingIntent.intent === 'ADD_DB_MEAL' && `Log Database Match: ${pendingIntent.data.name}`}
                                {pendingIntent.intent === 'UNVERIFIED_NOVEL_FOOD' && `AI Estimated: ${pendingIntent.data.name} (~${pendingIntent.data.estimatedCalories} kcal)`}
                                {pendingIntent.intent === 'GENERAL_SWAP' && `Swap out for something ${pendingIntent.data.preference || 'different'} (Effort: ${pendingIntent.data.effort})`}
                                {pendingIntent.intent === 'DINING_OUT' && `Log cheat meal: ${pendingIntent.data.name} (~${pendingIntent.data.estimatedCalories} kcal)`}
                                {pendingIntent.intent === 'MODIFY' && `Modifier detected. Adjusting components...`}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={handleConfirmIntent}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
                        >
                            <Check className="w-4 h-4" /> Apply Changes
                        </button>
                        <button
                            onClick={handleCancelIntent}
                            className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg font-medium text-sm transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Modal Backdrop (only visible when focused) */}
            {isFocused && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-200"
                    onClick={() => {
                        inputRef.current?.blur();
                        setIsFocused(false);
                    }}
                />
            )}

            {/* Main Input Bar */}
            <div className={`relative transition-all duration-300 ${pendingIntent ? 'opacity-50 pointer-events-none' : ''} ${isFocused ? 'z-50 scale-105 transform origin-bottom md:origin-center drop-shadow-2xl' : 'z-10'}`}>
                {activeContext && (
                    <div className="absolute -top-7 left-4 flex items-center gap-1.5 bg-indigo-100 text-indigo-700 px-3 py-1 rounded-t-lg text-xs font-semibold animate-in slide-in-from-bottom-2 border-x border-t border-indigo-200 shadow-sm">
                        <span>Editing: <span className="capitalize">{activeContext}</span></span>
                        <button type="button" onClick={onClearContext} className="hover:bg-indigo-300 rounded-full p-0.5 transition-colors">
                            <X size={12} />
                        </button>
                    </div>
                )}
                <form onSubmit={handleProcessIntent} className="relative w-full">
                    <div className={`relative flex items-center bg-white rounded-2xl transition-all duration-300 ${isFocused ? 'ring-4 ring-emerald-500/20 border border-emerald-500 shadow-2xl' : 'border-2 border-emerald-100 shadow-[0_8px_30px_rgb(16,185,129,0.15)] hover:shadow-[0_8px_30px_rgb(16,185,129,0.25)] hover:border-emerald-200'}`}>
                        <div className={`absolute left-4 ${isFocused ? 'text-emerald-500' : 'text-gray-400'} transition-colors duration-300`}>
                            {loading ? <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> : <Sparkles className="w-5 h-5" />}
                        </div>

                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onPointerDown={(e) => {
                                if (!activeContext && onRequestContext) {
                                    e.preventDefault();
                                    onRequestContext();
                                }
                            }}
                            onFocus={() => {
                                setIsFocused(true);
                                setShowSuggestions(true);
                            }}
                            onBlur={() => {
                                setIsFocused(false);
                                setTimeout(() => setShowSuggestions(false), 200);
                            }}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={disabled || loading || !!pendingIntent}
                            placeholder={loading ? "Thinking..." : "Tell me what you ate, or what you want to change..."}
                            className={`w-full bg-transparent text-gray-800 rounded-2xl py-4 pl-12 pr-14 outline-none placeholder:text-gray-400 disabled:bg-gray-50 text-[15px]`}
                        />

                        <button
                            type="submit"
                            disabled={!input.trim() || disabled || loading}
                            className={`absolute right-2 p-2 rounded-xl flex items-center justify-center transition-all ${input.trim() && !loading && !disabled
                                ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-700 hover:scale-105'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                }`}
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Suggestions Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.1)] border border-emerald-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                            {suggestions.map((meal) => (
                                <button
                                    key={meal.canonical_name + '_' + meal.matchedSlot}
                                    type="button"
                                    onClick={() => handleSuggestionClick(meal)}
                                    className="w-full text-left px-4 py-3 hover:bg-emerald-50 focus:bg-emerald-50 transition-colors flex items-center justify-between border-b border-gray-50 last:border-0"
                                >
                                    <div>
                                        <div className="font-medium text-gray-800 text-sm">{meal.display_name || meal.name}</div>
                                        <div className="text-xs text-gray-400 capitalize mt-0.5 font-medium">{meal.matchedSlot.replace('_', ' ')}</div>
                                    </div>
                                    <div className="flex gap-2 text-xs font-semibold shrink-0">
                                        <span className="text-emerald-700 bg-emerald-100 flex items-center justify-center min-w-[50px] py-1 rounded-md">{meal.protein}g P</span>
                                        <span className="text-orange-700 bg-orange-100 flex items-center justify-center min-w-[60px] py-1 rounded-md">{meal.cal} kcal</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {
                        error && (
                            <div className="flex items-center gap-1.5 mt-2 ml-2 text-red-500 text-xs font-medium animate-in slide-in-from-top-1">
                                <X className="w-3 h-3" />
                                {error}
                            </div>
                        )
                    }
                </form >
            </div>
        </div >
    );
};

export default Omnibox;
