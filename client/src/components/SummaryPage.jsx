import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import { alpha } from '@mui/material/styles';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import ReplayIcon from '@mui/icons-material/Replay';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { api } from '../api.js';

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export default function SummaryPage() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [bodies, setBodies] = useState({}); // id -> summary text
  const [copied, setCopied] = useState(null);
  const [claudeHint, setClaudeHint] = useState(null);
  const timer = useRef(null);

  const load = () =>
    api
      .summaries()
      .then((l) => {
        setList(l);
        // 진행 중이면 폴링 유지
        const anyPending = l.some((s) => s.status === 'pending');
        clearTimeout(timer.current);
        if (anyPending) timer.current = setTimeout(load, 3000);
      })
      .catch(() => setList([]));

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line
  }, []);

  const openDetail = async (s) => {
    if (openId === s.id) {
      setOpenId(null);
      return;
    }
    setOpenId(s.id);
    if (s.status === 'done' && bodies[s.id] === undefined) {
      try {
        const full = await api.summary(s.id);
        setBodies((b) => ({ ...b, [s.id]: full.summary || '' }));
      } catch {
        setBodies((b) => ({ ...b, [s.id]: '' }));
      }
    }
  };

  const retry = async (s, e) => {
    e.stopPropagation();
    try {
      await api.createSummary(s.sessionId);
      setBodies((b) => ({ ...b, [s.id]: undefined }));
      load();
    } catch {}
  };
  const remove = async (s, e) => {
    e.stopPropagation();
    if (!confirm(`'${s.title}' 요약을 삭제할까요?`)) return;
    await api.deleteSummary(s.id);
    if (openId === s.id) setOpenId(null);
    load();
  };
  const copy = async (s, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };
  const sendToClaude = async (s, text) => {
    // 팝업 차단 방지: 사용자 제스처 내에서 먼저 새 탭을 연 뒤 클립보드 복사
    const w = window.open('https://claude.ai/new', '_blank', 'noopener');
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    if (!w) {
      // 팝업이 막힌 경우: 직접 이동 안내
      window.open('https://claude.ai/new', '_blank');
    }
    setClaudeHint(s.id);
    setTimeout(() => setClaudeHint((v) => (v === s.id ? null : v)), 6000);
  };
  const download = (s, text) => {
    const blob = new Blob([`${s.title}\n${fmtDate(s.createdAt)}\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(s.title || 'summary').replace(/[\\/:*?"<>|]/g, '_')}_요약.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = (list || []).filter((s) => !q.trim() || (s.title || '').toLowerCase().includes(q.trim().toLowerCase()));
  const empty = list && list.length === 0;

  const StatusBadge = ({ s }) => {
    if (s.status === 'pending')
      return <Chip size="small" icon={<CircularProgress size={12} sx={{ ml: 0.5 }} />} label="요약 중" sx={{ height: 22, fontSize: 11 }} />;
    if (s.status === 'error')
      return <Chip size="small" color="error" variant="outlined" icon={<ErrorOutlineIcon sx={{ fontSize: 14 }} />} label="실패" sx={{ height: 22, fontSize: 11 }} />;
    return <Chip size="small" color="success" variant="outlined" icon={<CheckCircleIcon sx={{ fontSize: 14 }} />} label="완료" sx={{ height: 22, fontSize: 11 }} />;
  };

  return (
    <>
      <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">AI 요약</Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="제목 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ width: { xs: '100%', sm: 240 } }}
        />
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 820, mx: 'auto' }}>
          {empty && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <AutoAwesomeOutlinedIcon sx={{ fontSize: 40, opacity: 0.4 }} />
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary', mt: 1.5 }}>아직 요약된 회의가 없습니다</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.5 }}>세션 목록의 ⋮ 메뉴에서 ‘AI 요약’을 눌러 시작하세요.</Typography>
            </Box>
          )}
          {filtered.map((s) => {
            const body = bodies[s.id];
            const isOpen = openId === s.id;
            return (
              <Paper key={s.id} variant="outlined" sx={{ mb: 1.5, borderRadius: 3, overflow: 'hidden' }}>
                <Box
                  onClick={() => openDetail(s)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtDate(s.createdAt)} / {s.title || '(제목 없음)'}
                    </Typography>
                  </Box>
                  <StatusBadge s={s} />
                  {s.status === 'error' && (
                    <Tooltip title="재시도">
                      <IconButton size="small" onClick={(e) => retry(s, e)}><ReplayIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="삭제">
                    <IconButton size="small" onClick={(e) => remove(s, e)} sx={{ color: 'error.main' }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </Box>

                <Collapse in={isOpen} unmountOnExit>
                  <Box sx={{ px: 2.5, pb: 2, pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    {s.status === 'pending' && (
                      <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 2 }}>요약을 생성하고 있습니다…</Typography>
                    )}
                    {s.status === 'error' && (
                      <Box sx={{ py: 2 }}>
                        <Typography sx={{ fontSize: 13, color: 'error.main' }}>{s.error || '요약에 실패했습니다.'}</Typography>
                        <Button size="small" startIcon={<ReplayIcon />} onClick={(e) => retry(s, e)} sx={{ mt: 1 }}>다시 시도</Button>
                      </Box>
                    )}
                    {s.status === 'done' && body === undefined && (
                      <Box sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                        <CircularProgress size={14} /> <Typography sx={{ fontSize: 13 }}>불러오는 중…</Typography>
                      </Box>
                    )}
                    {s.status === 'done' && body !== undefined && (
                      <>
                        <Typography
                          component="div"
                          sx={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', mt: 1.5, color: 'text.primary' }}
                        >
                          {body}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 1.5 }}>
                          <Button
                            size="small"
                            startIcon={copied === s.id ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                            onClick={() => copy(s, body)}
                            sx={{ fontSize: 12, color: copied === s.id ? 'success.main' : 'text.secondary', minWidth: 0 }}
                          >
                            {copied === s.id ? '복사됨' : '복사'}
                          </Button>
                          <Button size="small" startIcon={<DownloadIcon fontSize="small" />} onClick={() => download(s, body)} sx={{ fontSize: 12, color: 'text.secondary', minWidth: 0 }}>
                            다운로드
                          </Button>
                          <Button size="small" startIcon={<OpenInNewIcon fontSize="small" />} onClick={() => sendToClaude(s, body)} sx={{ fontSize: 12, color: 'text.secondary', minWidth: 0 }}>
                            Claude로 보내기
                          </Button>
                        </Box>
                        {claudeHint === s.id && (
                          <Typography sx={{ fontSize: 11.5, color: 'primary.main', mt: 0.75 }}>
                            클립보드에 복사했습니다 · 열린 Claude 입력창에 붙여넣기(Ctrl/⌘+V) 하세요.
                          </Typography>
                        )}
                      </>
                    )}
                  </Box>
                </Collapse>
              </Paper>
            );
          })}
        </Box>
      </Box>
    </>
  );
}
