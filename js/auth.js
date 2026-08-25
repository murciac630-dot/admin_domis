import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export async function login(email,password){return signInWithEmailAndPassword(auth,email,password)}
export async function logout(){return signOut(auth)}
export async function resetPassword(email){return sendPasswordResetEmail(auth,email)}

export async function getCurrentProfile(user){
  const ref=doc(db,"usuarios",user.uid);
  const snap=await getDoc(ref);
  if(!snap.exists()) throw new Error("Tu cuenta existe en Authentication, pero no tiene perfil en Firestore.");
  const data=snap.data();
  if(data.activo===false || data.activo==="false") throw new Error("Tu usuario está desactivado.");
  return {uid:user.uid,email:user.email,...data};
}

export function watchAuth(callback){return onAuthStateChanged(auth,callback)}
