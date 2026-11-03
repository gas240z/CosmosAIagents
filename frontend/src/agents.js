import { createContext, useContext } from 'react'
import { Brain, Atom, Zap, Gem, FileSignature, Map, Rocket, ScanSearch, PackageCheck, Flag, Satellite, FolderTree, FileSearch, Search, ScrollText, ShieldCheck } from 'lucide-react'

export const ORDER = ['anthropic', 'openai', 'groq', 'gemini']

export const AGENTS = {
  anthropic: { id: 'anthropic', name: 'Anthropic', color: '#ff7a59', soft: '#ffb199', dark: '#c0391c', icon: Brain, trait: 'тёплый и вдумчивый' },
  openai: { id: 'openai', name: 'OpenAI', color: '#2fe3a1', soft: '#9bf5d3', dark: '#0a8c61', icon: Atom, trait: 'системный и точный' },
  groq: { id: 'groq', name: 'Groq', color: '#ff8a1f', soft: '#ffc27a', dark: '#c4580a', icon: Zap, trait: 'молниеносный' },
  gemini: { id: 'gemini', name: 'Gemini', color: '#7a8bff', soft: '#b9a6ff', dark: '#4a4fd6', icon: Gem, trait: 'двойная звезда' },
}

export const ACTORS = { orchestrator: { id: 'orchestrator', name: 'Оркестратор', color: '#ffd98a', dark: '#b8730a' }, ...AGENTS }

export const STATUS_LABEL = { idle: 'ожидает', thinking: 'думает', writing: 'пишет', done: 'готово', error: 'ошибка', offline: 'нет ключа' }

export const PHASES = [
  { id: 'contract', label: 'Контракт' },
  { id: 'plan', label: 'План' },
  { id: 'execute', label: 'Полёт' },
  { id: 'review', label: 'Ревью' },
  { id: 'package', label: 'Упаковка' },
]

export const STATION_ICONS = { start: Satellite, contract: FileSignature, plan: Map, wave: Rocket, review: ScanSearch, package: PackageCheck, finish: Flag }

// Тема: { light: boolean }
export const ThemeCtx = createContext({ light: false })
export const useTheme = () => useContext(ThemeCtx)

// Инструменты агентов: спутники вокруг планет
export const TOOLS = [
  { id: 'list_files', label: 'list_files — список файлов проекта', icon: FolderTree, color: '#38d7ff' },
  { id: 'read_file', label: 'read_file — прочитать файл коллеги', icon: FileSearch, color: '#a78bfa' },
  { id: 'search_code', label: 'search_code — поиск по коду', icon: Search, color: '#fbbf24' },
  { id: 'get_contract', label: 'get_contract — контракт проекта', icon: ScrollText, color: '#34d399' },
  { id: 'lint', label: 'lint — проверка синтаксиса и ссылок', icon: ShieldCheck, color: '#fb7185' },
]
