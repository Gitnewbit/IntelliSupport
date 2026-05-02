import {
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot
} from "firebase/firestore";
import { fbDb } from "./firebase";

export const FS = {
  async get(col, id) {
    const ref = doc(fbDb, col, id);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  },

  async set(col, id, data) {
    const ref = doc(fbDb, col, id);
    await setDoc(ref, data, { merge: true });
  },

  sub(col, callback) {
    const ref = collection(fbDb, col);
    return onSnapshot(ref, (snapshot) => {
      const data = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      callback(data);
    });
  }
};