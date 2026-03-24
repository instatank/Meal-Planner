import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ingredients } from '../data/ingredients';
import { mealDatabase } from '../data/mealDatabase';
import { FALLBACK_PROMPTS } from '../data/fallbackPrompts';

export default function AdminTools({ user, systemConfig }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // Automatically hide the migration pane if the AI brains are successfully verified in Firestore
  if (systemConfig && Object.keys(systemConfig).length > 0) {
    return null;
  }

  const handleMigration = async () => {
    if (!window.confirm('Are you sure you want to overwrite the live Firebase AI Brain with your local code files?')) return;
    
    setLoading(true);
    setStatus('Migrating ingredients...');
    try {
      // Deeply strip any undefined values which crash the Firebase GRPC socket layer
      const safeIngredients = JSON.parse(JSON.stringify(ingredients));
      const safeMeals = JSON.parse(JSON.stringify(mealDatabase));
      const safePrompts = JSON.parse(JSON.stringify(FALLBACK_PROMPTS));

      // 1. Ingredients
      await setDoc(doc(db, 'system_config', 'ingredients'), { data: safeIngredients });
      
      setStatus('Migrating meals...');
      // 2. Meals
      await setDoc(doc(db, 'system_config', 'meals'), { data: safeMeals });
      
      setStatus('Migrating prompts...');
      // 3. Prompts
      await setDoc(doc(db, 'system_config', 'prompts'), { 
        system_instructions: safePrompts 
      });

      setStatus('✅ Migration Complete! You can now safely edit the AI from your Firebase Console.');
    } catch (err) {
      console.error(err);
      setStatus('❌ Migration Failed. Check console.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-8">
      <h3 className="text-red-800 font-bold mb-2">🔥 Danger Zone: Admin Tools</h3>
      <p className="text-sm text-red-700 mb-4">
        Clicking this will forcefully overwrite the live scalable Firebase CMS configuration with the hardcoded Javascript models perfectly preserved in your local codebase.
      </p>
      
      <button 
        onClick={handleMigration}
        disabled={loading}
        className="bg-red-600 text-white font-semibold py-2 px-4 rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Uploading payload...' : 'Migrate Hardcoded AI to Cloud'}
      </button>

      {status && (
        <p className="mt-3 text-sm font-semibold text-gray-800">{status}</p>
      )}
    </div>
  );
}
