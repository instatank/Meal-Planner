// Demo stub for firebase/firestore — every read misses so the app falls back
// to the localStorage data we seed in demo-main.jsx. No network calls.
export const getFirestore = () => ({ __demo: true });
export const doc = () => ({ __demo: true });
export const getDoc = async () => ({ exists: () => false, data: () => null });
export const setDoc = async () => {};
