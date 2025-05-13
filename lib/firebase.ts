import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBFHEIoWMXun2BCoUd2z9Lv5f_iKNMhpc4",
  authDomain: "hang-out-king.firebaseapp.com",
  databaseURL: "https://hang-out-king-default-rtdb.firebaseio.com",
  projectId: "hang-out-king",
  storageBucket: "hang-out-king.appspot.com",
  messagingSenderId: "1064756850993",
  appId: "1:1064756850993:web:9f2252a2b4189b82978010",
  measurementId: "G-K5TS3B7WXK"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
