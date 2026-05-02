import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCsqmFDUpsi87Zf31jf0IgF9Q1iVFToX6AS",
  authDomain: "intellisupport-fab11.firebaseapp.com",
  projectId: "intellisupport-fab11",
  storageBucket: "intellisupport-fab11.appspot.com",
  messagingSenderId: "784909188513",
  appId: "1:784909188513:web:fb54aa47bc5618b6805fe0"
};

const app = initializeApp(firebaseConfig);

export const fbAuth = getAuth(app);
export const fbDb = getFirestore(app);