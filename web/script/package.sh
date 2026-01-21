#!/usr/bin/env bash

LOGFILE_PATH="/opt/logs"
LOGFILE_NAME="01-package-yeying-portal.log"
LOGFILE="$LOGFILE_PATH/$LOGFILE_NAME"
if [[ ! -d  "$LOGFILE_PATH" ]]
then
    mkdir -p "$LOGFILE_PATH"
fi

touch "$LOGFILE"

filesize=$(stat -c "%s" "$LOGFILE" )
if [[ "$filesize" -ge 1048576 ]]
then
    echo -e "clear old logs at $(date) to avoid log file too big" > "$LOGFILE"
fi

script_dir=$(cd "$(dirname "$0")" || exit;pwd)
source "${script_dir}"/functions_package.sh

work_dir=$(
  cd "${script_dir}"/.. || exit 1
  pwd
)
service_name=$(basename "$work_dir")

index=1
echo -e "step $index -- This is the begining of create package for ${service_name} [$(date)] " | tee -a "$LOGFILE"

version=$(node -p "require('${work_dir}/package.json').version")
if [ -z "${version}" ]; then
  echo -e " ERROR! the version could not be zero! " | tee -a "$LOGFILE"
  exit 3
fi


dist_dir=${work_dir}/dist
output_dir=${work_dir}/output
if [ -d "${output_dir}" ]; then
  rm -rf "${output_dir}"
fi


index=$((index+1))
echo -e "step $index -- prepare package files under directroy: ${output_dir} " | tee -a "$LOGFILE"
package_name="${service_name}"-"${version}"
file_name=$package_name.tar.gz
portal_dir=${output_dir}/${package_name}
mkdir -p "${portal_dir}"


index=$((index+1))
echo -e "step $index -- copy necessary file to  ${portal_dir} " | tee -a "$LOGFILE"
if [ ! -d "${dist_dir}" ]; then
  echo -e "please execute 'npm run build' before package! " | tee -a "$LOGFILE"
  exit 1;
fi
cp -rf "${dist_dir}" "${portal_dir}"/
cp -rf "${script_dir}" "${portal_dir}"/
formatted_date=$(date '+%Y%m%d_%H%M%S')
VERSION_FILE="version_information_$formatted_date"
record_version_information "$VERSION_FILE"
mv "$VERSION_FILE" "${portal_dir}"/


sleep 1
index=$((index+1))
echo -e "step $index -- generate package file. " | tee -a "$LOGFILE"
pushd "${output_dir}" || exit 2
tar -zcf "${file_name}" "${package_name}"
rm -rf "${package_name}"
popd  || exit 2


index=$((index+1))
echo -e "step $index -- package : ${file_name} under [ ${output_dir} ] is ready. [$(date)] " | tee -a "$LOGFILE"