; Customizacao do instalador NSIS.
;
; Unico objetivo: tirar os hooks do settings.json do Claude ao desinstalar.
; Sem isto, desinstalar o app deixa os hooks registrados para sempre, e toda
; sessao do Claude passa a pagar ~310ms por evento tentando falar com um app
; que nao existe mais.
;
; A remocao e feita pelo proprio app (`--remover-hooks`), que ja sabe fazer
; merge no JSON preservando os hooks que o usuario configurou a mao. Editar
; JSON em NSIS seria frageis e destrutivo.

!macro customUnInit
!macroend

!macro customUnInstall
  ; roda antes dos arquivos serem apagados, entao o executavel ainda existe
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 semExe
    DetailPrint "Removendo os hooks do Claude Code..."
    ; /TIMEOUT evita que uma desinstalacao trave esperando o processo; se
    ; estourar, o usuario ainda pode remover pelo botao dentro do app.
    nsExec::ExecToStack /TIMEOUT=15000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remover-hooks'
    Pop $0
    ${If} $0 == "0"
      DetailPrint "Hooks removidos."
    ${Else}
      DetailPrint "Nao consegui remover os hooks automaticamente (codigo $0)."
    ${EndIf}
  semExe:
!macroend
