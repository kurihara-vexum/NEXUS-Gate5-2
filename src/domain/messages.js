export const MESSAGES = Object.freeze({
  loanCreated: "端末の貸出を登録しました。",
  returned: "端末の返却を登録しました。",
  alreadyLoaned: "この端末は既に貸出中です。別の端末を選択してください。",
  pastDueDate: "返却予定日は今日以降の日付を指定してください。",
  invalidDueDate: "返却予定日を正しい日付で入力してください。",
  unavailableDevice: "この端末は貸出できない状態です。",
  inactiveBorrower: "無効な利用者には貸し出せません。",
  notFound: "指定された端末または利用者が存在しません。",
  noActiveLoan: "この端末に返却可能な貸出記録はありません。",
  conflict: "他の操作で端末の状態が更新されました。画面を再読み込みしてください。",
});

export class BusinessError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "BusinessError";
    this.statusCode = statusCode;
  }
}
