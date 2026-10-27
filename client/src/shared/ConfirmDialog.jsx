import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

/* 공용 확인 다이얼로그 — 브라우저 기본 confirm() 대체(테마 정합·모바일 표시 일관).
   사용: const [confirmReq, setConfirmReq] = useState(null);
        setConfirmReq({ title, message, confirmLabel, onOk: () => {...} });
        <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} /> */
export default function ConfirmDialog({ req, onClose }) {
  const ok = () => { const fn = req && req.onOk; onClose(); if (fn) fn(); };
  return (
    <Dialog open={!!req} onClose={onClose} PaperProps={{ sx: { width: 400, maxWidth: 'calc(100vw - 32px)' } }}>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 17, pb: 1 }}>{(req && req.title) || '확인'}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', whiteSpace: 'pre-line' }}>{req && req.message}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>취소</Button>
        <Button variant="contained" color={req && req.color ? req.color : 'error'} onClick={ok} autoFocus>
          {(req && req.confirmLabel) || '삭제'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
