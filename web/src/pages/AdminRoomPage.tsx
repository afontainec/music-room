import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  deleteRoom,
  listTracks,
  removeTrack,
  renameRoom,
  SessionExpiredError,
  uploadTrack,
  type Track,
} from '../api/admin';
import { getRoom, NotFoundError, type Room } from '../api/rooms';
import { TrackList, type TracksState } from '../components/TrackList';
import { useStaffSession } from '../hooks/useStaffSession';
import { Link, navigate } from '../router';

type RoomState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ready'; room: Room };

// A room in the staff area: rename and delete controls, its tracks, an upload form and a remove
// button per track. The list is fetched again after every upload or removal, so it always shows
// what visitors get.
export function AdminRoomPage({ id }: { id: string }) {
  const session = useStaffSession();
  const [room, setRoom] = useState<RoomState>({ status: 'loading' });
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tracks, setTracks] = useState<TracksState>({ status: 'loading' });
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the latest request may update the list, so a slow earlier one cannot overwrite it.
  const latest = useRef(0);
  const ready = session.status === 'ready';

  const loadTracks = useCallback(
    (showLoading: boolean) => {
      const request = ++latest.current;
      if (showLoading) setTracks({ status: 'loading' });
      listTracks(id)
        .then((list) => request === latest.current && setTracks({ status: 'ready', tracks: list }))
        .catch(() => request === latest.current && setTracks({ status: 'error' }));
    },
    [id],
  );

  useEffect(() => {
    if (!ready) return;
    let active = true;
    getRoom(id)
      .then((r) => {
        if (!active) return;
        setRoom({ status: 'ready', room: r });
        setNameDraft(r.name);
      })
      .catch((err) => active && setRoom({ status: err instanceof NotFoundError ? 'not-found' : 'error' }));
    loadTracks(true);
    return () => {
      active = false;
      latest.current++;
    };
  }, [id, ready, loadTracks]);

  // Shared handling for failed actions: an expired session goes back to the login, anything else
  // shows the server's message (rename and delete next to the room controls, the rest below upload).
  const failed = (err: unknown, fallback: string, show = setActionError) => {
    if (err instanceof SessionExpiredError) return navigate('/admin/login');
    show(err instanceof Error && err.message ? err.message : fallback);
  };

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return setRoomError('Enter a name for the room.');
    setRenaming(true);
    setRoomError(null);
    try {
      const renamed = await renameRoom(id, nameDraft);
      setRoom({ status: 'ready', room: renamed });
      setNameDraft(renamed.name);
    } catch (err) {
      if (err instanceof NotFoundError) return setRoom({ status: 'not-found' });
      failed(err, 'Could not rename the room. Please try again.', setRoomError);
    } finally {
      setRenaming(false);
    }
  };

  const onDelete = async (name: string) => {
    if (!window.confirm(`Delete “${name}” and all its tracks? Visitors will no longer see it.`)) return;
    setDeleting(true);
    setRoomError(null);
    try {
      await deleteRoom(id);
      navigate('/admin');
    } catch (err) {
      // Already deleted (in another tab): back to the list, which no longer shows it.
      if (err instanceof NotFoundError) return navigate('/admin');
      failed(err, 'Could not delete the room. Please try again.', setRoomError);
      setDeleting(false);
    }
  };

  const onUpload = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return setActionError('Choose an mp3 file to upload.');
    setUploading(true);
    setActionError(null);
    try {
      await uploadTrack(id, file);
      // Clear the picker only if it still holds this file: staff may already have chosen the next one.
      if (fileInput.current?.files?.[0] === file) fileInput.current.value = '';
    } catch (err) {
      failed(err, 'Could not upload the track. Please try again.');
    } finally {
      setUploading(false);
      loadTracks(false);
    }
  };

  const onRemove = async (track: Track) => {
    if (!window.confirm(`Remove “${track.name}” from this room?`)) return;
    setRemovingId(track.id);
    setActionError(null);
    try {
      await removeTrack(track.id);
    } catch (err) {
      // Already gone (removed in another tab): the refreshed list shows that.
      if (!(err instanceof NotFoundError)) failed(err, 'Could not remove the track. Please try again.');
    } finally {
      setRemovingId(null);
      loadTracks(false);
    }
  };

  return (
    <main className="page">
      <Link to="/admin" className="back-link">
        ← All rooms
      </Link>
      {session.status === 'loading' || (ready && room.status === 'loading') ? (
        <p className="status">Loading room…</p>
      ) : session.status === 'error' ? (
        <p className="status" role="alert">
          Could not check your session. Please try again later.
        </p>
      ) : room.status === 'not-found' ? (
        <h1>Room not found</h1>
      ) : room.status === 'error' ? (
        <p className="status" role="alert">
          Could not load this room. Please try again later.
        </p>
      ) : room.status === 'ready' ? (
        <>
          <h1>{room.room.name}</h1>
          <form className="inline-form" onSubmit={onRename}>
            <label>
              Room name
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={100} />
            </label>
            <button type="submit" disabled={renaming || nameDraft.trim() === room.room.name}>
              {renaming ? 'Renaming…' : 'Rename'}
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={deleting}
              onClick={() => onDelete(room.room.name)}
            >
              {deleting ? 'Deleting…' : 'Delete room'}
            </button>
          </form>
          {roomError && (
            <p className="form-error" role="alert">
              {roomError}
            </p>
          )}
          <h2>Tracks</h2>
          <form className="upload-form" onSubmit={onUpload}>
            <label>
              Mp3 file
              <input ref={fileInput} type="file" name="file" accept=".mp3,audio/mpeg" />
            </label>
            <button type="submit" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </form>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <TrackList state={tracks} onRetry={() => loadTracks(true)} onRemove={onRemove} removingId={removingId} />
        </>
      ) : null}
    </main>
  );
}
