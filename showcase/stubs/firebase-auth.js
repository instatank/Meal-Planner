// Demo stub for firebase/auth — immediately reports a signed-in demo user so the
// real MealPlannerMain UI renders without a Google OAuth popup. No network calls.
export const getAuth = () => ({ __demo: true });
export class GoogleAuthProvider {
  setCustomParameters() {}
}
export const onAuthStateChanged = (_auth, cb) => {
  cb({ displayName: 'Demo Chef', uid: 'demo-user', email: 'demo@mealmap.app' });
  return () => {};
};
export const signInWithPopup = async () => ({ user: { uid: 'demo-user' } });
export const signOut = async () => {};
