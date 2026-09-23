import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

export interface UserBookmark {
  id: string;
  userId: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  createdAt?: any;
}

export interface UserHistoryItem {
  id: string;
  userId: string;
  lat: number;
  lon: number;
  formattedAddress?: string;
  createdAt?: any;
}

export function subscribeBookmarks(
  userId: string,
  onUpdate: (bookmarks: UserBookmark[]) => void,
  onError?: (err: any) => void
) {
  const collPath = `users/${userId}/bookmarks`;
  const q = query(collection(db, 'users', userId, 'bookmarks'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: UserBookmark[] = [];
      snapshot.forEach((docSnap) => {
        items.push(docSnap.data() as UserBookmark);
      });
      onUpdate(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, collPath);
    }
  );
}

export async function addBookmark(
  name: string,
  lat: number,
  lon: number,
  address?: string
): Promise<UserBookmark | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const bookmarkId = `bm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const path = `users/${user.uid}/bookmarks/${bookmarkId}`;

  const bookmarkData: any = {
    id: bookmarkId,
    userId: user.uid,
    name: name.trim().slice(0, 150),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    createdAt: serverTimestamp(),
  };

  if (address && address.trim()) {
    bookmarkData.address = address.trim().slice(0, 500);
  }

  try {
    await setDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId), bookmarkData);
    return bookmarkData;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    return null;
  }
}

export async function deleteBookmark(bookmarkId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  const path = `users/${user.uid}/bookmarks/${bookmarkId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    return false;
  }
}

export function subscribeHistory(
  userId: string,
  onUpdate: (history: UserHistoryItem[]) => void,
  onError?: (err: any) => void
) {
  const collPath = `users/${userId}/history`;
  const q = query(collection(db, 'users', userId, 'history'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: UserHistoryItem[] = [];
      snapshot.forEach((docSnap) => {
        items.push(docSnap.data() as UserHistoryItem);
      });
      onUpdate(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, collPath);
    }
  );
}

export async function addHistory(
  lat: number,
  lon: number,
  formattedAddress?: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const historyId = `hist_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const path = `users/${user.uid}/history/${historyId}`;

  const historyData: any = {
    id: historyId,
    userId: user.uid,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    createdAt: serverTimestamp(),
  };

  if (formattedAddress && formattedAddress.trim()) {
    historyData.formattedAddress = formattedAddress.trim().slice(0, 500);
  }

  try {
    await setDoc(doc(db, 'users', user.uid, 'history', historyId), historyData);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteHistory(historyId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  const path = `users/${user.uid}/history/${historyId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'history', historyId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    return false;
  }
}
