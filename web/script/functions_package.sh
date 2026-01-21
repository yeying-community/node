#!/usr/bin/env bash
# this file define functions used for package operation, such as create, generate, publish, upgrade and so on

function record_version_information() {
  local recode_file=$1
  echo -e "\n========branch information:" | tee "$recode_file"
  git branch --show-current | tee -a "$recode_file"
  echo -e "\n========commit log information:" >> "$recode_file"
  git log -3 | grep -v Author | tee -a "$recode_file"
  echo -e "\n====Finished" | tee -a "$recode_file"
}

function pull_latest_code() {
	local branch_name=$1
	git reset --hard HEAD
	git checkout "$branch_name"
	git pull origin "$branch_name" || { exit 1; }
}


can_ssh_login() {
    local login_user="$1"
    local login_host="$2"

    if [[ -z "$login_user" || -z "$login_host" ]]; then
        echo "ERRROR: login user and ip address are necessary" >&2
        return 1
    fi

    ssh -o BatchMode=yes \
        -o ConnectTimeout=10 \
        -o PreferredAuthentications=publickey \
        "${login_user}@${login_host}" true &>/dev/null

    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}