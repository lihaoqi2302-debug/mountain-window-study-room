import { createRoot } from 'react-dom/client'
import App from './App'
import { joinStudyRoom, suspendRoom } from './online/roomSession'
import './styles.css'

function followInvite() {
  const invite = new URL(location.href).searchParams.get('room')
  if (invite !== null) void joinStudyRoom(invite)
}

createRoot(document.getElementById('root')!).render(<App />)
followInvite()

window.addEventListener('pagehide', suspendRoom)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) followInvite()
})
