import { db } from "./firebase.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, Timestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export const col = name => collection(db,name);

export async function getUsers(){const s=await getDocs(col("usuarios"));return s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.nombre||a.email||a.id).localeCompare(String(b.nombre||b.email||b.id),"es"))}
export async function getUser(uid){const s=await getDoc(doc(db,"usuarios",uid));return s.exists()?{id:s.id,...s.data()}:null}
export async function saveUser(uid,data){return setDoc(doc(db,"usuarios",uid),{...data,actualizadoEn:serverTimestamp()},{merge:true})}

export async function createTurno(user){
  const ref=await addDoc(col("turnos"),{usuarioId:user.uid,usuarioNombre:user.nombre||user.email?.split("@")[0]||user.uid,usuarioEmail:user.email||null,fechaLocal:new Date().toISOString().slice(0,10),inicio:serverTimestamp(),estado:"activo",pedidos:0,creadoEn:serverTimestamp()});
  return ref.id;
}
export async function closeTurno(id){return updateDoc(doc(db,"turnos",id),{fin:serverTimestamp(),estado:"cerrado",actualizadoEn:serverTimestamp()})}
export async function getActiveTurno(uid){const s=await getDocs(query(col("turnos"),where("usuarioId","==",uid),where("estado","==","activo"),limit(1)));return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()}}
export async function addEntrega(data){return addDoc(col("entregas"),{...data,creadoPor:data.creadoPor||data.usuarioId,usuarioEmail:data.usuarioEmail||null,timestamp:data.timestamp||serverTimestamp(),creadoEn:serverTimestamp(),actualizadoEn:serverTimestamp(),estado:"registrado"})}
export async function getOwnEntregas(uid){const s=await getDocs(query(col("entregas"),where("usuarioId","==",uid),orderBy("timestamp","desc"),limit(100)));return s.docs.map(d=>({id:d.id,...d.data()}))}
export async function getEntregasByDate(start,end,uid=null){
  const clauses=[where("timestamp",">=",start),where("timestamp","<=",end),orderBy("timestamp","desc"),limit(1000)];
  if(uid) clauses.unshift(where("usuarioId","==",uid));
  const s=await getDocs(query(col("entregas"),...clauses));return s.docs.map(d=>({id:d.id,...d.data()}))
}
export async function updateEntrega(id,data){return updateDoc(doc(db,"entregas",id),{...data,actualizadoEn:serverTimestamp()})}
export async function cancelEntrega(id,motivo,user){return updateDoc(doc(db,"entregas",id),{estado:"anulado",motivoAnulacion:motivo,anuladoPor:user.uid,anuladoPorNombre:user.nombre,anuladoEn:serverTimestamp(),actualizadoEn:serverTimestamp()})}
export async function setTracking(userId,data){return setDoc(doc(db,"tracking_actual",userId),{...data,usuarioId:userId,actualizadoEn:serverTimestamp()},{merge:true})}
export async function getAllTracking(){const s=await getDocs(col("tracking_actual"));return s.docs.map(d=>({id:d.id,...d.data()}))}
export async function audit(data){return addDoc(col("auditoria"),{...data,fecha:serverTimestamp()})}
